package com.visiblefunction;

import com.visiblefunction.VisibleFunctionExportJson.ExportRecord;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.BlockingDeque;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.LinkedBlockingDeque;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.BooleanSupplier;

final class VisibleFunctionExportServer {
	private static final int DEFAULT_LIMIT = 500;
	private static final int MAX_LIMIT = 5000;
	private static final int MAX_STREAM_BATCH = 512;
	private static final int MAX_RETAINED_RECORDS = 20000;
	private static final int RETAINED_RECORD_PRUNE_BATCH = 1000;
	private static final int MAX_PENDING_STREAM_RECORDS = 8192;
	// Per-client outbound buffer. Writes go through each client's own thread, so a client that is
	// not reading only backs up its own queue; once it overflows the client is dropped instead of
	// stalling delivery to everyone else.
	private static final int CLIENT_QUEUE_CAPACITY = 256;
	private static final long KEEPALIVE_INTERVAL_MILLIS = 15000;
	private static final String FRONTEND_RESOURCE_ROOT = "/assets/visiblefunction/web";
	private static final VisibleFunctionExportServer INSTANCE = new VisibleFunctionExportServer();

	private final Object recordsLock = new Object();
	private final List<ExportRecord> records = new ArrayList<>();
	private final TickFilterEngine<ExportRecord> tickFilterEngine = new TickFilterEngine<>();
	private final List<SseClient> clients = new CopyOnWriteArrayList<>();
	private final BlockingDeque<ExportRecord> pendingRecords = new LinkedBlockingDeque<>(MAX_PENDING_STREAM_RECORDS);
	private final AtomicLong nextRecordId = new AtomicLong(1);
	private final AtomicLong nextSessionId = new AtomicLong(System.currentTimeMillis());
	private final AtomicLong droppedStreamRecords = new AtomicLong();
	private final AtomicLong slowClientDisconnects = new AtomicLong();
	private volatile ServerSocket serverSocket;
	private volatile boolean running;
	private volatile int port;
	private volatile long sessionId;
	private volatile long currentTick;
	private Thread acceptThread;
	private Thread broadcastThread;

	private VisibleFunctionExportServer() {
	}

	static VisibleFunctionExportServer instance() {
		return INSTANCE;
	}

	synchronized boolean start(int requestedPort) {
		if (running && port == requestedPort) {
			return true;
		}

		stop();
		synchronized (recordsLock) {
			records.clear();
			tickFilterEngine.clear();
		}
		nextRecordId.set(1);
		droppedStreamRecords.set(0);
		slowClientDisconnects.set(0);
		sessionId = nextSessionId.getAndIncrement();
		currentTick = 0;

		try {
			ServerSocket socket = new ServerSocket();
			socket.bind(new InetSocketAddress(InetAddress.getLoopbackAddress(), requestedPort));
			serverSocket = socket;
			port = requestedPort;
			running = true;
			acceptThread = new Thread(this::acceptLoop, "VisibleFunction Export Accept");
			acceptThread.setDaemon(true);
			acceptThread.start();
			broadcastThread = new Thread(this::broadcastLoop, "VisibleFunction Export Broadcast");
			broadcastThread.setDaemon(true);
			broadcastThread.start();
			VisibleFunction.LOGGER.info("VisibleFunction export server started on http://127.0.0.1:{}", requestedPort);
			return true;
		} catch (IOException exception) {
			running = false;
			serverSocket = null;
			VisibleFunction.LOGGER.error("Failed to start VisibleFunction export server on port {}", requestedPort, exception);
			return false;
		}
	}

	synchronized void stop() {
		running = false;
		closeServerSocket();
		for (SseClient client : clients) {
			client.close();
		}
		clients.clear();
		pendingRecords.clear();
		if (acceptThread != null) {
			acceptThread.interrupt();
			acceptThread = null;
		}
		if (broadcastThread != null) {
			broadcastThread.interrupt();
			broadcastThread = null;
		}
	}

	boolean running() {
		return running;
	}

	int port() {
		return port;
	}

	int recordCount() {
		synchronized (recordsLock) {
			return records.size();
		}
	}

	private long oldestRecordId() {
		synchronized (recordsLock) {
			return records.isEmpty() ? 0 : records.getFirst().id();
		}
	}

	private long latestRecordId() {
		synchronized (recordsLock) {
			return records.isEmpty() ? 0 : records.getLast().id();
		}
	}

	long sessionId() {
		return sessionId;
	}

	void publish(VisibleFunctionEventPayload payload) {
		if (!running) {
			return;
		}

		ExportRecord record = new ExportRecord(nextRecordId.getAndIncrement(), payload, System.currentTimeMillis(), sessionId);
		synchronized (recordsLock) {
			records.add(record);
			TickFilterEngine.Input<ExportRecord> input = VisibleFunctionExportJson.tickFilterInput(record);
			currentTick = Math.max(currentTick, input.tick());
			tickFilterEngine.add(input);
			pruneRetainedRecords();
		}
		offerPendingRecord(record);
	}

	private void pruneRetainedRecords() {
		int overflow = records.size() - MAX_RETAINED_RECORDS;
		if (overflow <= RETAINED_RECORD_PRUNE_BATCH) {
			return;
		}

		for (int index = 0; index < overflow; index++) {
			tickFilterEngine.removeRecord(records.get(index).id());
		}
		records.subList(0, overflow).clear();
	}

	void tick(long gameTick) {
		currentTick = gameTick;
	}

	private void offerPendingRecord(ExportRecord record) {
		while (!pendingRecords.offerLast(record)) {
			if (pendingRecords.pollFirst() != null) {
				droppedStreamRecords.incrementAndGet();
			}
		}
	}

	private void acceptLoop() {
		while (running) {
			try {
				Socket socket = serverSocket.accept();
				Thread handler = new Thread(() -> handle(socket), "VisibleFunction Export Request");
				handler.setDaemon(true);
				handler.start();
			} catch (IOException exception) {
				if (running) {
					VisibleFunction.LOGGER.warn("VisibleFunction export accept failed", exception);
				}
			}
		}
	}

	private void broadcastLoop() {
		while (running) {
			try {
				ExportRecord record = pendingRecords.takeFirst();
				List<ExportRecord> batch = new ArrayList<>();
				batch.add(record);
				pendingRecords.drainTo(batch, MAX_STREAM_BATCH - 1);

				if (clients.isEmpty()) {
					continue;
				}

				String eventName = batch.size() == 1 ? "record" : "records";
				String eventJson = batch.size() == 1 ? VisibleFunctionExportJson.record(batch.getFirst()) : VisibleFunctionExportJson.records(batch);
				for (SseClient client : clients) {
					// Non-blocking enqueue: a slow client can never stall this loop. If its buffer is
					// full it has fallen too far behind, so drop it.
					if (!client.offer(eventName, eventJson)) {
						clients.remove(client);
						slowClientDisconnects.incrementAndGet();
						client.close();
					}
				}
			} catch (InterruptedException ignored) {
				Thread.currentThread().interrupt();
				return;
			}
		}
	}

	private void handle(Socket socket) {
		try (socket) {
			BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
			String requestLine = reader.readLine();
			if (requestLine == null || requestLine.isBlank()) {
				return;
			}

			String[] parts = requestLine.split(" ");
			if (parts.length < 2 || !"GET".equals(parts[0])) {
				writeText(socket, 405, "Method Not Allowed", "text/plain; charset=utf-8", "Only GET is supported.");
				return;
			}

			while (true) {
				String header = reader.readLine();
				if (header == null || header.isEmpty()) {
					break;
				}
			}

			String target = parts[1];
			String path = target;
			String query = "";
			int queryStart = target.indexOf('?');
			if (queryStart >= 0) {
				path = target.substring(0, queryStart);
				query = target.substring(queryStart + 1);
			}

			switch (path) {
				case "/", "/index.html" -> writeFrontendResource(socket, path);
				case "/health" -> writeJson(socket, healthJson());
				case "/api/v1/records" -> writeJson(socket, recordsResponse(query));
				case "/api/v1/grouped" -> writeJson(socket, groupedResponse(query));
				case "/api/v1/tick-filter" -> writeJson(socket, tickFilterResponse(query));
				case "/api/v1/datapack-analysis" -> writeJson(socket, DatapackAnalysisIndex.json());
				case "/api/v1/datapack-triggers" -> writeJson(socket, DatapackTriggerIndex.json());
				case "/api/v1/recording/status" -> writeJson(socket, VisibleFunctionRecordingManager.instance().statusJson());
				case "/api/v1/recordings" -> writeJson(socket, VisibleFunctionRecordingManager.instance().recordingsJson());
				case "/api/v1/recordings/latest" -> writeRecording(
					socket,
					VisibleFunctionRecordingManager.instance().latestRecordingFile()
				);
				case "/api/v1/stream" -> stream(socket);
				default -> {
					if (path.startsWith("/api/v1/recordings/")) {
						String id = decode(path.substring("/api/v1/recordings/".length()));
						writeRecording(socket, VisibleFunctionRecordingManager.instance().findRecordingFile(id));
					} else if (path.startsWith("/assets/")) {
						writeFrontendResource(socket, path);
					} else {
						writeText(socket, 404, "Not Found", "text/plain; charset=utf-8", "VisibleFunction export endpoint not found.");
					}
				}
			}
		} catch (IOException exception) {
			if (running) {
				VisibleFunction.LOGGER.debug("VisibleFunction export request failed", exception);
			}
		}
	}

	private String recordsResponse(String query) {
		return VisibleFunctionExportJson.records(selectedRecords(query));
	}

	private String healthJson() {
		return VisibleFunctionExportJson.health(
			running,
			port,
			recordCount(),
			sessionId,
			currentTick,
			oldestRecordId(),
			latestRecordId(),
			droppedStreamRecords.get(),
			slowClientDisconnects.get()
		);
	}

	private String groupedResponse(String query) {
		return VisibleFunctionExportJson.grouped(selectedRecords(query));
	}

	private String tickFilterResponse(String query) {
		if (!query.isBlank()) {
			return VisibleFunctionExportJson.tickFilter(selectedRecords(query));
		}
		synchronized (recordsLock) {
			return VisibleFunctionExportJson.tickFilterSnapshots(tickFilterEngine.snapshots(currentTick));
		}
	}

	private List<ExportRecord> selectedRecords(String query) {
		Map<String, String> params = parseQuery(query);
		long after = parseLong(params.get("after"), 0);
		int limit = Math.max(1, Math.min(MAX_LIMIT, (int) parseLong(params.get("limit"), DEFAULT_LIMIT)));
		boolean tail = parseBoolean(params.get("tail"));
		List<ExportRecord> selected = new ArrayList<>();

		synchronized (recordsLock) {
			if (tail && after <= 0) {
				int start = Math.max(0, records.size() - limit);
				for (int index = start; index < records.size(); index++) {
					selected.add(records.get(index));
				}
				return selected;
			}

			int start = firstRecordAfter(after);
			for (int index = start; index < records.size(); index++) {
				selected.add(records.get(index));
				if (selected.size() >= limit) {
					break;
				}
			}
		}
		return selected;
	}

	private int firstRecordAfter(long after) {
		int low = 0;
		int high = records.size();

		while (low < high) {
			int mid = (low + high) >>> 1;
			if (records.get(mid).id() <= after) {
				low = mid + 1;
			} else {
				high = mid;
			}
		}
		return low;
	}

	private void stream(Socket socket) throws IOException {
		socket.setKeepAlive(true);
		OutputStream output = socket.getOutputStream();
		PrintWriter writer = new PrintWriter(new OutputStreamWriter(output, StandardCharsets.UTF_8), true);
		writer.print("HTTP/1.1 200 OK\r\n");
		writer.print("Content-Type: text/event-stream; charset=utf-8\r\n");
		writer.print("Cache-Control: no-cache\r\n");
		writer.print("Connection: keep-alive\r\n");
		writer.print("Access-Control-Allow-Origin: *\r\n");
		writer.print("\r\n");
		writer.flush();

		SseClient client = new SseClient(socket, writer);
		clients.add(client);
		try {
			// Prime with the current health snapshot, then hand the socket to the client's own
			// writer loop. Every socket write happens on this thread, so a blocked write only ever
			// stalls this one client — the broadcast loop merely enqueues frames.
			client.writeHello(healthJson());
			client.runUntilClosed(this::running);
		} finally {
			clients.remove(client);
			client.close();
		}
	}

	private static void writeJson(Socket socket, String body) throws IOException {
		writeText(socket, 200, "OK", "application/json; charset=utf-8", body);
	}

	private static void writeFrontendResource(Socket socket, String path) throws IOException {
		String decodedPath;
		try {
			decodedPath = decode(path);
		} catch (IllegalArgumentException exception) {
			writeText(socket, 400, "Bad Request", "text/plain; charset=utf-8", "Invalid frontend resource path.");
			return;
		}

		if (decodedPath.indexOf('\0') >= 0 || decodedPath.contains("\\") || containsParentSegment(decodedPath)) {
			writeText(socket, 400, "Bad Request", "text/plain; charset=utf-8", "Invalid frontend resource path.");
			return;
		}

		String relativePath = switch (decodedPath) {
			case "/", "/index.html" -> "/index.html";
			default -> decodedPath.startsWith("/assets/") ? decodedPath : null;
		};
		if (relativePath == null) {
			writeText(socket, 404, "Not Found", "text/plain; charset=utf-8", "VisibleFunction frontend resource not found.");
			return;
		}

		String resourcePath = FRONTEND_RESOURCE_ROOT + relativePath;
		try (InputStream resource = VisibleFunctionExportServer.class.getResourceAsStream(resourcePath)) {
			if (resource == null) {
				writeText(socket, 404, "Not Found", "text/plain; charset=utf-8", "VisibleFunction frontend resource not found.");
				return;
			}

			boolean index = "/index.html".equals(relativePath);
			String cacheControl = index ? "no-cache" : "public, max-age=31536000, immutable";
			writeBytes(socket, 200, "OK", contentType(relativePath), resource.readAllBytes(), cacheControl);
		}
	}

	private static void writeText(Socket socket, int status, String reason, String contentType, String body) throws IOException {
		byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
		writeBytes(socket, status, reason, contentType, bytes, null);
	}

	private static void writeRecording(Socket socket, Path file) throws IOException {
		if (file == null) {
			writeJson(socket, "{\"recording\":null}");
			return;
		}
		long length = Files.size(file);
		OutputStream output = socket.getOutputStream();
		PrintWriter writer = new PrintWriter(new OutputStreamWriter(output, StandardCharsets.UTF_8), false);
		writer.print("HTTP/1.1 200 OK\r\n");
		writer.print("Content-Type: application/json; charset=utf-8\r\n");
		writer.print("Content-Length: " + length + "\r\n");
		writer.print("Cache-Control: no-store\r\n");
		writer.print("Access-Control-Allow-Origin: *\r\n");
		writer.print("X-Content-Type-Options: nosniff\r\n");
		writer.print("Connection: close\r\n");
		writer.print("\r\n");
		writer.flush();
		Files.copy(file, output);
		output.flush();
	}

	private static void writeBytes(
		Socket socket,
		int status,
		String reason,
		String contentType,
		byte[] bytes,
		String cacheControl
	) throws IOException {
		OutputStream output = socket.getOutputStream();
		PrintWriter writer = new PrintWriter(new OutputStreamWriter(output, StandardCharsets.UTF_8), false);
		writer.print("HTTP/1.1 " + status + " " + reason + "\r\n");
		writer.print("Content-Type: " + contentType + "\r\n");
		writer.print("Content-Length: " + bytes.length + "\r\n");
		if (cacheControl != null) {
			writer.print("Cache-Control: " + cacheControl + "\r\n");
		}
		writer.print("Access-Control-Allow-Origin: *\r\n");
		writer.print("X-Content-Type-Options: nosniff\r\n");
		writer.print("Connection: close\r\n");
		writer.print("\r\n");
		writer.flush();
		output.write(bytes);
		output.flush();
	}

	private static boolean containsParentSegment(String path) {
		for (String segment : path.split("/", -1)) {
			if ("..".equals(segment)) {
				return true;
			}
		}
		return false;
	}

	private static String contentType(String path) {
		String normalized = path.toLowerCase(Locale.ROOT);
		if (normalized.endsWith(".html")) {
			return "text/html; charset=utf-8";
		}
		if (normalized.endsWith(".js") || normalized.endsWith(".mjs")) {
			return "text/javascript; charset=utf-8";
		}
		if (normalized.endsWith(".css")) {
			return "text/css; charset=utf-8";
		}
		if (normalized.endsWith(".json") || normalized.endsWith(".map")) {
			return "application/json; charset=utf-8";
		}
		if (normalized.endsWith(".svg")) {
			return "image/svg+xml";
		}
		if (normalized.endsWith(".png")) {
			return "image/png";
		}
		if (normalized.endsWith(".webp")) {
			return "image/webp";
		}
		if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) {
			return "image/jpeg";
		}
		if (normalized.endsWith(".ico")) {
			return "image/x-icon";
		}
		if (normalized.endsWith(".woff2")) {
			return "font/woff2";
		}
		if (normalized.endsWith(".woff")) {
			return "font/woff";
		}
		if (normalized.endsWith(".ttf")) {
			return "font/ttf";
		}
		return "application/octet-stream";
	}

	private static Map<String, String> parseQuery(String query) {
		Map<String, String> params = new ConcurrentHashMap<>();
		if (query == null || query.isBlank()) {
			return params;
		}

		for (String pair : query.split("&")) {
			int separator = pair.indexOf('=');
			if (separator < 0) {
				params.put(decode(pair), "");
			} else {
				params.put(decode(pair.substring(0, separator)), decode(pair.substring(separator + 1)));
			}
		}
		return params;
	}

	private static String decode(String value) {
		return URLDecoder.decode(value, StandardCharsets.UTF_8);
	}

	private static long parseLong(String value, long fallback) {
		if (value == null || value.isBlank()) {
			return fallback;
		}

		try {
			return Long.parseLong(value.trim().toLowerCase(Locale.ROOT));
		} catch (NumberFormatException ignored) {
			return fallback;
		}
	}

	private static boolean parseBoolean(String value) {
		if (value == null || value.isBlank()) {
			return false;
		}

		String normalized = value.trim().toLowerCase(Locale.ROOT);
		return "true".equals(normalized) || "1".equals(normalized) || "yes".equals(normalized);
	}

	private void closeServerSocket() {
		ServerSocket socket = serverSocket;
		serverSocket = null;
		if (socket == null) {
			return;
		}

		try {
			socket.close();
		} catch (IOException ignored) {
		}
	}

	private static final class SseClient {
		private final Socket socket;
		private final PrintWriter writer;
		private final BlockingQueue<String> outbound = new LinkedBlockingQueue<>(CLIENT_QUEUE_CAPACITY);
		private volatile boolean closed;
		private volatile Thread worker;

		private SseClient(Socket socket, PrintWriter writer) {
			this.socket = socket;
			this.writer = writer;
		}

		// Called from the broadcast thread. Non-blocking: enqueues a formatted SSE frame and returns
		// false if the buffer is full (the client is too slow and should be dropped).
		private boolean offer(String event, String json) {
			return !closed && outbound.offer("event: " + event + "\ndata: " + json + "\n\n");
		}

		private void writeHello(String json) {
			writer.print("event: hello\ndata: " + json + "\n\n");
			writer.flush();
		}

		// Runs on the client's own request thread, draining queued frames to the socket and emitting
		// a keepalive comment whenever the queue stays idle. Any blocking socket write only stalls
		// this thread; the shared broadcast loop is never affected.
		private void runUntilClosed(BooleanSupplier running) {
			worker = Thread.currentThread();
			try {
				while (running.getAsBoolean() && !closed && !socket.isClosed()) {
					String frame = outbound.poll(KEEPALIVE_INTERVAL_MILLIS, TimeUnit.MILLISECONDS);
					writer.print(frame != null ? frame : ": keepalive\n\n");
					writer.flush();
					if (writer.checkError()) {
						break;
					}
				}
			} catch (InterruptedException ignored) {
				Thread.currentThread().interrupt();
			}
		}

		private void close() {
			closed = true;
			Thread current = worker;
			if (current != null) {
				current.interrupt();
			}
			try {
				socket.close();
			} catch (IOException ignored) {
			}
		}
	}
}
