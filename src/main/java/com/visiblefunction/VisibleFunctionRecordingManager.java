package com.visiblefunction;

import com.google.gson.JsonParser;
import com.visiblefunction.VisibleFunctionExportJson.ExportRecord;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.DirectoryStream;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Supplier;
import java.util.regex.Pattern;

final class VisibleFunctionRecordingManager {
	private static final DateTimeFormatter FILE_TIME_FORMAT = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss-SSS");
	private static final Pattern SAFE_RECORDING_ID = Pattern.compile("[A-Za-z0-9._-]+");
	private static final String JOURNAL_FORMAT_V2 = "visiblefunction-recording-journal-v2";
	private static final String JOURNAL_FORMAT_V3 = "visiblefunction-recording-journal-v3";
	private static final int RECORDING_FLUSH_INTERVAL = 64;
	private static final long DISK_CHECK_INTERVAL_BYTES = 1024L * 1024;
	private static final long FOOTER_RESERVE_BYTES = 16L * 1024 * 1024;
	private static final int RECORDING_TICK_FILTER_IDS_PER_BUCKET = 8;
	private static final int RECORDING_TICK_FILTER_SAMPLES_PER_BUCKET = 0;
	private static final RecordingLimits DEFAULT_LIMITS = defaultLimits();
	private static final VisibleFunctionRecordingManager INSTANCE = new VisibleFunctionRecordingManager(
		Path.of("visiblefunction-recordings"),
		Clock.systemDefaultZone(),
		() -> UUID.randomUUID().toString().substring(0, 8),
		DEFAULT_LIMITS,
		path -> Files.getFileStore(path).getUsableSpace()
	);

	private final Path recordingDir;
	private final Clock clock;
	private final Supplier<String> uniqueSuffix;
	private final RecordingLimits limits;
	private final UsableSpaceProbe usableSpaceProbe;
	private final AtomicLong nextRecordId = new AtomicLong(1);
	private final List<CompletedRecording> completedRecordings = new ArrayList<>();
	private RecordingSession activeSession;
	private String lastStopReason = "none";
	private long lastPeriodicLimitCheckMillis;

	VisibleFunctionRecordingManager(Path recordingDir, Clock clock, Supplier<String> uniqueSuffix) {
		this(
			recordingDir,
			clock,
			uniqueSuffix,
			DEFAULT_LIMITS,
			path -> Files.getFileStore(path).getUsableSpace()
		);
	}

	VisibleFunctionRecordingManager(
		Path recordingDir,
		Clock clock,
		Supplier<String> uniqueSuffix,
		RecordingLimits limits,
		UsableSpaceProbe usableSpaceProbe
	) {
		this.recordingDir = recordingDir;
		this.clock = clock;
		this.uniqueSuffix = uniqueSuffix;
		this.limits = limits.validated();
		this.usableSpaceProbe = usableSpaceProbe;
	}

	static VisibleFunctionRecordingManager instance() {
		return INSTANCE;
	}

	synchronized boolean active() {
		return activeSession != null;
	}

	synchronized RecordingResult start() {
		if (activeSession != null) {
			return new RecordingResult(false, "VisibleFunction recording already active: " + activeSession.id());
		}

		try {
			Files.createDirectories(recordingDir);
			DirectoryStats stats = directoryStats();
			String rejection = startRejection(stats);
			if (rejection != null) {
				lastStopReason = rejection;
				return new RecordingResult(false, "VisibleFunction recording refused: " + rejection);
			}
			activeSession = createSession(stats.totalBytes());
		} catch (IOException exception) {
			VisibleFunction.LOGGER.error("Failed to start VisibleFunction recording", exception);
			lastStopReason = "io_error";
			return new RecordingResult(false, "VisibleFunction recording failed to start: " + exception.getMessage());
		}

		nextRecordId.set(1);
		lastStopReason = "recording";
		lastPeriodicLimitCheckMillis = clock.millis();
		return new RecordingResult(true, "VisibleFunction recording started: " + activeSession.id());
	}

	private String startRejection(DirectoryStats stats) throws IOException {
		if (stats.fileCount() >= limits.maxFiles()) {
			return "file_count_limit";
		}
		if (saturatedAdd(stats.totalBytes(), FOOTER_RESERVE_BYTES) > limits.maxTotalBytes()) {
			return "directory_size_limit";
		}
		long usable = usableSpaceProbe.usableSpace(recordingDir);
		if (usable < saturatedAdd(limits.minFreeBytes(), FOOTER_RESERVE_BYTES)) {
			return "low_disk_space";
		}
		return null;
	}

	private RecordingSession createSession(long completedBytes) throws IOException {
		long startedAtMillis = clock.millis();
		String timestamp = FILE_TIME_FORMAT.format(LocalDateTime.ofInstant(
			Instant.ofEpochMilli(startedAtMillis),
			clock.getZone()
		));

		for (int attempt = 0; attempt < 100; attempt++) {
			String suffix = sanitizeSuffix(uniqueSuffix.get());
			String id = timestamp + "-" + suffix + (attempt == 0 ? "" : "-" + attempt);
			Path journal = recordingJournalFile(id);
			if (Files.exists(recordingFilePath(id))) {
				continue;
			}
			try {
				OutputStream output = new BufferedOutputStream(Files.newOutputStream(
					journal,
					StandardOpenOption.CREATE_NEW,
					StandardOpenOption.WRITE
				));
				RecordingSession session = new RecordingSession(id, startedAtMillis, journal, output, completedBytes);
				session.writeHeader();
				return session;
			} catch (FileAlreadyExistsException ignored) {
				// Generate another opaque suffix without replacing an existing recording.
			}
		}
		throw new IOException("Could not allocate a unique recording id");
	}

	synchronized RecordingResult stop() {
		if (activeSession == null) {
			return new RecordingResult(false, "VisibleFunction recording is not active.");
		}
		return finishActive("manual");
	}

	private RecordingResult finishActive(String stopReason) {
		RecordingSession session = activeSession;
		activeSession = null;
		if (session == null) {
			return new RecordingResult(false, "VisibleFunction recording is not active.");
		}

		try {
			session.close();
			CompletedRecording completed = finalizeV3Journal(
				session.journalFile(),
				clock.millis(),
				false,
				stopReason,
				session.scan()
			);
			completedRecordings.add(completed);
			lastStopReason = stopReason;
			return new RecordingResult(true, "VisibleFunction recording saved: " + absolutePath(completed.file()));
		} catch (IOException exception) {
			VisibleFunction.LOGGER.error("Failed to finalize VisibleFunction recording {}", session.id(), exception);
			lastStopReason = "io_error";
			return new RecordingResult(false, "VisibleFunction recording failed to save: " + exception.getMessage());
		}
	}

	synchronized RecordingResult toggle() {
		return activeSession == null ? start() : stop();
	}

	synchronized void stopIfActive() {
		if (activeSession != null) {
			finishActive("server_stopping");
		}
	}

	synchronized void tick() {
		RecordingSession session = activeSession;
		if (session == null) {
			return;
		}
		long now = clock.millis();
		if (now - session.startedAtMillis() >= limits.maxDurationMillis()) {
			finishActive("duration_limit");
			return;
		}
		if (now - lastPeriodicLimitCheckMillis < 1000) {
			return;
		}
		lastPeriodicLimitCheckMillis = now;
		try {
			DirectoryStats stats = directoryStats();
			long trackedSessionTotal = saturatedAdd(session.completedBytesAtStart(), session.bytesWritten());
			long projectedTotal = saturatedAdd(
				Math.max(stats.totalBytes(), trackedSessionTotal),
				FOOTER_RESERVE_BYTES
			);
			if (stats.fileCount() > limits.maxFiles()) {
				finishActive("file_count_limit");
			} else if (projectedTotal > limits.maxTotalBytes()) {
				finishActive("directory_size_limit");
			} else if (usableSpaceProbe.usableSpace(recordingDir)
				< saturatedAdd(limits.minFreeBytes(), FOOTER_RESERVE_BYTES)) {
				finishActive("low_disk_space");
			}
		} catch (IOException exception) {
			VisibleFunction.LOGGER.warn("VisibleFunction recording limit check failed; stopping recording safely", exception);
			finishActive("disk_check_failed");
		}
	}

	synchronized void recoverInterruptedRecordings() {
		if (!Files.isDirectory(recordingDir)) {
			return;
		}

		try (DirectoryStream<Path> stream = Files.newDirectoryStream(recordingDir, "visiblefunction-recording-*.journal.tmp")) {
			for (Path journal : stream) {
				recoverJournal(journal);
			}
		} catch (IOException exception) {
			VisibleFunction.LOGGER.warn("Failed to scan interrupted VisibleFunction recordings", exception);
		}
	}

	private void recoverJournal(Path journal) {
		try {
			String header = firstLine(journal);
			if (isV3Header(header)) {
				JournalScan scan = scanV3Journal(journal);
				if (Files.exists(recordingFilePath(scan.metadata().id()))) {
					Files.deleteIfExists(journal);
					return;
				}
				CompletedRecording completed = finalizeV3Journal(
					journal,
					Math.max(scan.metadata().startedAtMillis(), Files.getLastModifiedTime(journal).toMillis()),
					true,
					"recovered_after_interruption"
				);
				completedRecordings.add(completed);
				VisibleFunction.LOGGER.info("Recovered interrupted VisibleFunction recording {}", completed.id());
				return;
			}

			JournalMetadata legacy = parseV2JournalHeader(header, journal);
			if (legacy != null) {
				CompletedRecording completed = finalizeLegacyV2Journal(
					legacy,
					journal,
					Math.max(legacy.startedAtMillis(), Files.getLastModifiedTime(journal).toMillis())
				);
				completedRecordings.add(completed);
				VisibleFunction.LOGGER.info("Recovered legacy VisibleFunction recording {}", completed.id());
				return;
			}
			VisibleFunction.LOGGER.warn("Ignoring invalid VisibleFunction recording journal {}", journal);
		} catch (IOException exception) {
			VisibleFunction.LOGGER.warn("Failed to recover VisibleFunction recording journal {}", journal, exception);
		}
	}

	synchronized void publish(VisibleFunctionEventPayload payload) {
		RecordingSession session = activeSession;
		if (session == null) {
			return;
		}

		long now = clock.millis();
		ExportRecord record = new ExportRecord(
			nextRecordId.getAndIncrement(),
			payload,
			now,
			VisibleFunctionExportServer.instance().sessionId()
		);
		byte[] encoded = session.encodeRecord(record);
		try {
			String limitReason = limitReason(session, encoded.length, now);
			if (limitReason != null) {
				RecordingResult result = finishActive(limitReason);
				VisibleFunction.LOGGER.warn("{}; the current record was not written. {}", limitReason, result.message());
				return;
			}
			session.append(record, encoded);
		} catch (IOException exception) {
			VisibleFunction.LOGGER.error("VisibleFunction recording {} stopped after write failure", session.id(), exception);
			session.closeQuietly();
			activeSession = null;
			lastStopReason = "io_error";
		}
	}

	private String limitReason(RecordingSession session, int recordBytes, long now) throws IOException {
		if (now - session.startedAtMillis() >= limits.maxDurationMillis()) {
			return "duration_limit";
		}
		long projected = saturatedAdd(
			saturatedAdd(session.bytesWritten(), recordBytes),
			FOOTER_RESERVE_BYTES
		);
		if (projected > limits.maxBytes()) {
			return "file_size_limit";
		}
		if (saturatedAdd(session.completedBytesAtStart(), projected) > limits.maxTotalBytes()) {
			return "directory_size_limit";
		}
		if (session.shouldCheckDisk(recordBytes)) {
			long usable = usableSpaceProbe.usableSpace(recordingDir);
			long required = saturatedAdd(
				limits.minFreeBytes(),
				saturatedAdd(recordBytes, FOOTER_RESERVE_BYTES)
			);
			if (usable < required) {
				return "low_disk_space";
			}
			session.markDiskChecked();
		}
		return null;
	}

	synchronized String statusJson() {
		List<CompletedRecording> known = knownRecordings();
		Map<String, String> values = new LinkedHashMap<>();
		values.put("active", Boolean.toString(activeSession != null));
		values.put("activeId", activeSession == null ? "none" : activeSession.id());
		values.put("activeRecords", Integer.toString(activeSession == null ? 0 : activeSession.recordCount()));
		values.put("activeBytes", Long.toString(activeSession == null ? 0 : activeSession.bytesWritten()));
		values.put("directory", absolutePath(recordingDir));
		values.put("activeFile", activeSession == null ? "none" : absolutePath(activeSession.journalFile()));
		values.put("completed", Integer.toString(known.size()));
		values.put("latest", known.isEmpty() ? "none" : known.getLast().id());
		values.put("lastStopReason", lastStopReason);
		values.put("maxBytes", Long.toString(limits.maxBytes()));
		values.put("maxDurationMillis", Long.toString(limits.maxDurationMillis()));
		values.put("maxFiles", Integer.toString(limits.maxFiles()));
		values.put("maxTotalBytes", Long.toString(limits.maxTotalBytes()));
		values.put("minFreeBytes", Long.toString(limits.minFreeBytes()));
		return VisibleFunctionExportJson.simpleObject(values);
	}

	synchronized String recordingsJson() {
		List<CompletedRecording> known = knownRecordings();
		StringBuilder json = new StringBuilder(256);
		json.append("{\"recordings\":[");
		for (int index = 0; index < known.size(); index++) {
			if (index > 0) {
				json.append(',');
			}
			metadataJson(json, known.get(index));
		}
		json.append("]}");
		return json.toString();
	}

	synchronized String latestRecordingJson() {
		List<CompletedRecording> known = knownRecordings();
		return known.isEmpty() ? "{\"recording\":null}" : recordingJson(known.getLast().id());
	}

	synchronized Path latestRecordingFile() {
		List<CompletedRecording> known = knownRecordings();
		return known.isEmpty() ? null : readableRecordingFile(known.getLast().file());
	}

	synchronized Path findRecordingFile(String id) {
		if (!isSafeRecordingId(id)) {
			return null;
		}
		for (CompletedRecording recording : completedRecordings) {
			if (recording.id().equals(id)) {
				return readableRecordingFile(recording.file());
			}
		}
		return readableRecordingFile(recordingFilePath(id));
	}

	synchronized String recordingJson(String id) {
		Path file = findRecordingFile(id);
		return file == null ? "{\"recording\":null}" : readRecordingFile(file, id);
	}

	private CompletedRecording finalizeV3Journal(
		Path journal,
		long endedAtMillis,
		boolean recovered,
		String stopReason
	) throws IOException {
		return finalizeV3Journal(journal, endedAtMillis, recovered, stopReason, scanV3Journal(journal));
	}

	private CompletedRecording finalizeV3Journal(
		Path journal,
		long endedAtMillis,
		boolean recovered,
		String stopReason,
		JournalScan scan
	) throws IOException {
		JournalMetadata metadata = scan.metadata();
		Path file = recordingFilePath(metadata.id());
		if (Files.exists(file)) {
			throw new FileAlreadyExistsException(file.toString());
		}

		try (FileChannel channel = FileChannel.open(journal, StandardOpenOption.WRITE)) {
			channel.truncate(scan.lastGoodOffset());
			channel.force(true);
		}

		String footer = recordingFooter(
			metadata,
			endedAtMillis,
			file,
			scan.records(),
			recovered,
			stopReason,
			scan.tickFilter()
		);
		byte[] footerBytes = footer.getBytes(StandardCharsets.UTF_8);
		if (footerBytes.length > FOOTER_RESERVE_BYTES
			|| saturatedAdd(scan.lastGoodOffset(), footerBytes.length) > limits.maxBytes()) {
			footer = recordingFooter(metadata, endedAtMillis, file, scan.records(), recovered, stopReason, List.of());
			footerBytes = footer.getBytes(StandardCharsets.UTF_8);
		}
		long usable = usableSpaceProbe.usableSpace(recordingDir);
		if (usable < saturatedAdd(limits.minFreeBytes(), footerBytes.length)) {
			footer = recordingFooter(metadata, endedAtMillis, file, scan.records(), recovered, stopReason, List.of());
			footerBytes = footer.getBytes(StandardCharsets.UTF_8);
		}
		if (usable < saturatedAdd(limits.minFreeBytes(), footerBytes.length)) {
			throw new IOException("Insufficient free disk space to finalize recording " + metadata.id());
		}

		try (OutputStream output = new BufferedOutputStream(Files.newOutputStream(journal, StandardOpenOption.APPEND))) {
			output.write(footerBytes);
			output.flush();
		}
		force(journal);
		movePublished(journal, file);
		return new CompletedRecording(
			metadata.id(),
			metadata.startedAtMillis(),
			endedAtMillis,
			file,
			scan.records(),
			Files.size(file),
			recovered,
			stopReason
		);
	}

	private CompletedRecording finalizeLegacyV2Journal(
		JournalMetadata metadata,
		Path journal,
		long endedAtMillis
	) throws IOException {
		Path file = recordingFilePath(metadata.id());
		Path staging = recordingDir.resolve("visiblefunction-recording-" + metadata.id() + ".legacy-recovery.part");
		if (Files.exists(file)) {
			Files.deleteIfExists(journal);
			return metadataFromFile(file);
		}
		Files.deleteIfExists(staging);

		JournalScan scan = scanV2Journal(journal, metadata);
		long journalBytes = Files.size(journal);
		long recoverySpace = saturatedAdd(
			limits.minFreeBytes(),
			saturatedAdd(journalBytes, FOOTER_RESERVE_BYTES)
		);
		if (usableSpaceProbe.usableSpace(recordingDir) < recoverySpace) {
			throw new IOException("Insufficient free disk space to recover legacy recording " + metadata.id());
		}
		try (
			BufferedReader reader = Files.newBufferedReader(journal, StandardCharsets.UTF_8);
			OutputStream output = new BufferedOutputStream(Files.newOutputStream(
				staging,
				StandardOpenOption.CREATE_NEW,
				StandardOpenOption.WRITE
			))
		) {
			reader.readLine();
			writeUtf8(output, "{\"records\":[");
			boolean first = true;
			String line;
			while ((line = reader.readLine()) != null) {
				if (line.isBlank() || parseRecord(line) == null) {
					continue;
				}
				if (!first) {
					writeUtf8(output, ",");
				}
				writeUtf8(output, line);
				first = false;
			}
			writeUtf8(output, recordingFooter(
				metadata,
				endedAtMillis,
				file,
				scan.records(),
				true,
				"recovered_legacy_journal",
				scan.tickFilter()
			));
		}
		force(staging);
		movePublished(staging, file);
		Files.deleteIfExists(journal);
		return new CompletedRecording(
			metadata.id(),
			metadata.startedAtMillis(),
			endedAtMillis,
			file,
			scan.records(),
			Files.size(file),
			true,
			"recovered_legacy_journal"
		);
	}

	private static JournalScan scanV3Journal(Path journal) throws IOException {
		TickFilterEngine<ExportRecord> engine = recordingTickFilter();
		ByteArrayOutputStream line = new ByteArrayOutputStream(8192);
		byte[] buffer = new byte[64 * 1024];
		long offset = 0;
		long lastGoodOffset = 0;
		int records = 0;
		long currentTick = 0;
		JournalMetadata metadata = null;
		boolean invalid = false;

		try (BufferedInputStream input = new BufferedInputStream(Files.newInputStream(journal))) {
			int read;
			while (!invalid && (read = input.read(buffer)) >= 0) {
				for (int index = 0; index < read; index++) {
					byte value = buffer[index];
					offset++;
					if (value != '\n') {
						line.write(value);
						continue;
					}

					String text = line.toString(StandardCharsets.UTF_8);
					line.reset();
					if (metadata == null) {
						metadata = parseV3JournalHeader(text, journal);
						if (metadata == null) {
							throw new IOException("Invalid v3 recording journal header: " + journal);
						}
						lastGoodOffset = offset;
						continue;
					}
					String recordText = text.startsWith(",") ? text.substring(1) : text;
					ExportRecord record = parseRecord(recordText);
					if (record == null) {
						invalid = true;
						break;
					}
					TickFilterEngine.Input<ExportRecord> tickInput = VisibleFunctionExportJson.tickFilterInput(record);
					engine.add(tickInput);
					currentTick = Math.max(currentTick, tickInput.tick());
					records++;
					lastGoodOffset = offset;
				}
			}
		}

		if (metadata == null) {
			throw new IOException("Empty v3 recording journal: " + journal);
		}
		return new JournalScan(metadata, records, engine.snapshots(currentTick), lastGoodOffset);
	}

	private static JournalScan scanV2Journal(Path journal, JournalMetadata metadata) throws IOException {
		TickFilterEngine<ExportRecord> engine = recordingTickFilter();
		int records = 0;
		long currentTick = 0;
		try (BufferedReader reader = Files.newBufferedReader(journal, StandardCharsets.UTF_8)) {
			reader.readLine();
			String line;
			while ((line = reader.readLine()) != null) {
				ExportRecord record = parseRecord(line);
				if (record == null) {
					continue;
				}
				TickFilterEngine.Input<ExportRecord> input = VisibleFunctionExportJson.tickFilterInput(record);
				engine.add(input);
				currentTick = Math.max(currentTick, input.tick());
				records++;
			}
		}
		return new JournalScan(metadata, records, engine.snapshots(currentTick), Files.size(journal));
	}

	private static TickFilterEngine<ExportRecord> recordingTickFilter() {
		return new TickFilterEngine<>(
			RECORDING_TICK_FILTER_IDS_PER_BUCKET,
			RECORDING_TICK_FILTER_SAMPLES_PER_BUCKET
		);
	}

	private static ExportRecord parseRecord(String line) {
		try {
			var json = JsonParser.parseString(line).getAsJsonObject();
			VisibleFunctionEventPayload payload = new VisibleFunctionEventPayload(
				json.get("type").getAsString(),
				json.get("subject").getAsString(),
				json.get("summary").getAsString(),
				fieldText(json.getAsJsonObject("basicFields")),
				fieldText(json.getAsJsonObject("detailedFields"))
			);
			return new ExportRecord(
				json.get("id").getAsLong(),
				payload,
				json.get("timestampMillis").getAsLong(),
				json.get("sessionId").getAsLong()
			);
		} catch (RuntimeException ignored) {
			return null;
		}
	}

	private static String fieldText(com.google.gson.JsonObject fields) {
		if (fields == null) {
			return "";
		}
		StringBuilder text = new StringBuilder();
		for (Map.Entry<String, com.google.gson.JsonElement> entry : fields.entrySet()) {
			text.append("- ").append(entry.getKey()).append(": ").append(entry.getValue().getAsString()).append('\n');
		}
		return text.toString();
	}

	private static String firstLine(Path file) throws IOException {
		try (BufferedReader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
			return reader.readLine();
		}
	}

	private static boolean isV3Header(String header) {
		return header != null && header.contains("\"format\":\"" + JOURNAL_FORMAT_V3 + "\"");
	}

	private static JournalMetadata parseV3JournalHeader(String header, Path file) {
		if (!isV3Header(header)) {
			return null;
		}
		try {
			String prefix = "{\"journal\":";
			String suffix = ",\"records\":[";
			if (!header.startsWith(prefix) || !header.endsWith(suffix)) {
				return null;
			}
			String metadataJson = header.substring(prefix.length(), header.length() - suffix.length());
			var json = JsonParser.parseString(metadataJson).getAsJsonObject();
			String id = json.get("id").getAsString();
			if (!isSafeRecordingId(id) || !journalName(id).equals(file.getFileName().toString())) {
				return null;
			}
			return new JournalMetadata(id, json.get("startedAtMillis").getAsLong());
		} catch (RuntimeException ignored) {
			return null;
		}
	}

	private static JournalMetadata parseV2JournalHeader(String header, Path file) {
		if (header == null) {
			return null;
		}
		try {
			var json = JsonParser.parseString(header).getAsJsonObject();
			if (!JOURNAL_FORMAT_V2.equals(json.get("journal").getAsString())) {
				return null;
			}
			String id = json.get("id").getAsString();
			if (!isSafeRecordingId(id) || !journalName(id).equals(file.getFileName().toString())) {
				return null;
			}
			return new JournalMetadata(id, json.get("startedAtMillis").getAsLong());
		} catch (RuntimeException ignored) {
			return null;
		}
	}

	private static String recordingFooter(
		JournalMetadata metadata,
		long endedAtMillis,
		Path file,
		int records,
		boolean recovered,
		String stopReason,
		List<TickFilterEngine.Snapshot<ExportRecord>> tickFilter
	) {
		StringBuilder json = new StringBuilder(512);
		json.append("],\"data\":");
		json.append(emptyGroupedDataJson(records, tickFilter));
		json.append(",\"recording\":{");
		property(json, "id", metadata.id()).append(',');
		property(json, "startedAtMillis", metadata.startedAtMillis()).append(',');
		property(json, "endedAtMillis", endedAtMillis).append(',');
		property(json, "durationMillis", Math.max(0, endedAtMillis - metadata.startedAtMillis())).append(',');
		property(json, "file", file.toString()).append(',');
		property(json, "records", records).append(',');
		property(json, "format", "records-v3").append(',');
		property(json, "recovered", recovered).append(',');
		property(json, "stopReason", stopReason);
		json.append("}}");
		return json.toString();
	}

	private static String emptyGroupedDataJson(
		int records,
		List<TickFilterEngine.Snapshot<ExportRecord>> tickFilter
	) {
		return "{\"counts\":{\"commands\":0,\"events\":0,\"functions\":0,\"other\":" + records
			+ "},\"commands\":[],\"events\":[],\"functions\":[],\"other\":[],"
			+ "\"commandsByType\":{},\"eventsByAction\":{},\"functionsById\":{},\"tickFilter\":"
			+ VisibleFunctionExportJson.tickFilterArrayJson(tickFilter) + "}";
	}

	private static void movePublished(Path journal, Path file) throws IOException {
		try {
			Files.move(journal, file, StandardCopyOption.ATOMIC_MOVE);
		} catch (AtomicMoveNotSupportedException ignored) {
			Files.move(journal, file);
		}
	}

	private static void force(Path file) throws IOException {
		try (FileChannel channel = FileChannel.open(file, StandardOpenOption.WRITE)) {
			channel.force(true);
		}
	}

	private static String readRecordingFile(Path file, String id) {
		try {
			return Files.readString(file, StandardCharsets.UTF_8);
		} catch (IOException exception) {
			VisibleFunction.LOGGER.warn("Failed to read VisibleFunction recording {}", id, exception);
			return "{\"recording\":null}";
		}
	}

	private static Path readableRecordingFile(Path file) {
		return file != null && Files.isRegularFile(file) ? file : null;
	}

	private static void metadataJson(StringBuilder json, CompletedRecording recording) {
		json.append('{');
		property(json, "id", recording.id()).append(',');
		property(json, "startedAtMillis", recording.startedAtMillis()).append(',');
		property(json, "endedAtMillis", recording.endedAtMillis()).append(',');
		property(json, "durationMillis", Math.max(0, recording.endedAtMillis() - recording.startedAtMillis())).append(',');
		property(json, "file", recording.file().toString()).append(',');
		property(json, "records", recording.recordCount()).append(',');
		property(json, "sizeBytes", recording.sizeBytes()).append(',');
		property(json, "recovered", recording.recovered()).append(',');
		property(json, "stopReason", recording.stopReason());
		json.append('}');
	}

	private List<CompletedRecording> knownRecordings() {
		Map<String, CompletedRecording> known = new LinkedHashMap<>();
		for (CompletedRecording recording : completedRecordings) {
			known.put(recording.id(), recording);
		}
		if (Files.isDirectory(recordingDir)) {
			try (DirectoryStream<Path> stream = Files.newDirectoryStream(recordingDir, "visiblefunction-recording-*.json")) {
				for (Path file : stream) {
					CompletedRecording recording = metadataFromFile(file);
					if (recording != null) {
						known.putIfAbsent(recording.id(), recording);
					}
				}
			} catch (IOException exception) {
				VisibleFunction.LOGGER.warn("Failed to scan VisibleFunction recordings directory", exception);
			}
		}
		List<CompletedRecording> sorted = new ArrayList<>(known.values());
		sorted.sort(Comparator.comparingLong(CompletedRecording::startedAtMillis));
		return sorted;
	}

	private DirectoryStats directoryStats() throws IOException {
		int count = 0;
		long bytes = 0;
		try (DirectoryStream<Path> stream = Files.newDirectoryStream(recordingDir, "visiblefunction-recording-*")) {
			for (Path file : stream) {
				if (Files.isRegularFile(file)) {
					count++;
					bytes = saturatedAdd(bytes, Files.size(file));
				}
			}
		}
		return new DirectoryStats(count, bytes);
	}

	private static CompletedRecording metadataFromFile(Path file) {
		if (file == null) {
			return null;
		}
		String id = idFromFile(file);
		if (!isSafeRecordingId(id)) {
			return null;
		}
		try {
			String metadata = metadataText(file);
			long modified = Files.getLastModifiedTime(file).toMillis();
			return new CompletedRecording(
				id,
				longField(metadata, "startedAtMillis", modified),
				longField(metadata, "endedAtMillis", modified),
				file,
				(int) longField(metadata, "records", 0),
				Files.size(file),
				booleanField(metadata, "recovered", false),
				stringField(metadata, "stopReason", "unknown")
			);
		} catch (IOException exception) {
			VisibleFunction.LOGGER.warn("Failed to inspect VisibleFunction recording {}", file, exception);
			return null;
		}
	}

	private static String metadataText(Path file) throws IOException {
		long size = Files.size(file);
		int prefixLength = (int) Math.min(4096, size);
		int suffixLength = (int) Math.min(16384, size);
		byte[] prefix = new byte[prefixLength];
		byte[] suffix = new byte[suffixLength];
		try (var channel = FileChannel.open(file, StandardOpenOption.READ)) {
			channel.read(java.nio.ByteBuffer.wrap(prefix), 0);
			channel.read(java.nio.ByteBuffer.wrap(suffix), Math.max(0, size - suffixLength));
		}
		return new String(prefix, StandardCharsets.UTF_8) + "\n" + new String(suffix, StandardCharsets.UTF_8);
	}

	private static String idFromFile(Path file) {
		String name = file.getFileName().toString();
		String prefix = "visiblefunction-recording-";
		String suffix = ".json";
		return name.startsWith(prefix) && name.endsWith(suffix)
			? name.substring(prefix.length(), name.length() - suffix.length())
			: "";
	}

	private static boolean isSafeRecordingId(String id) {
		return id != null && SAFE_RECORDING_ID.matcher(id).matches();
	}

	private static long longField(String json, String name, long fallback) {
		String marker = "\"" + name + "\":";
		int start = json.lastIndexOf(marker);
		if (start < 0) {
			return fallback;
		}
		start += marker.length();
		int end = start;
		while (end < json.length() && (Character.isDigit(json.charAt(end)) || json.charAt(end) == '-')) {
			end++;
		}
		try {
			return Long.parseLong(json.substring(start, end));
		} catch (NumberFormatException ignored) {
			return fallback;
		}
	}

	private static boolean booleanField(String json, String name, boolean fallback) {
		String marker = "\"" + name + "\":";
		int start = json.lastIndexOf(marker);
		if (start < 0) {
			return fallback;
		}
		start += marker.length();
		if (json.startsWith("true", start)) {
			return true;
		}
		if (json.startsWith("false", start)) {
			return false;
		}
		return fallback;
	}

	private static String stringField(String json, String name, String fallback) {
		String marker = "\"" + name + "\":\"";
		int start = json.lastIndexOf(marker);
		if (start < 0) {
			return fallback;
		}
		start += marker.length();
		int end = json.indexOf('"', start);
		return end < 0 ? fallback : json.substring(start, end);
	}

	private static void writeUtf8(OutputStream output, String text) throws IOException {
		output.write(text.getBytes(StandardCharsets.UTF_8));
	}

	private static long systemLong(String name, long fallback) {
		try {
			return Math.max(1, Long.parseLong(System.getProperty(name, Long.toString(fallback))));
		} catch (NumberFormatException ignored) {
			return fallback;
		}
	}

	private static RecordingLimits defaultLimits() {
		long maxBytes = Math.max(
			FOOTER_RESERVE_BYTES + 1,
			systemLong("visiblefunction.recording.maxBytes", 1024L * 1024 * 1024)
		);
		long maxTotalBytes = Math.max(
			maxBytes,
			systemLong("visiblefunction.recording.maxTotalBytes", 10L * 1024 * 1024 * 1024)
		);
		long maxFiles = systemLong("visiblefunction.recording.maxFiles", 100);
		return new RecordingLimits(
			maxBytes,
			systemLong("visiblefunction.recording.maxDurationMillis", 2L * 60 * 60 * 1000),
			(int) Math.min(Integer.MAX_VALUE, maxFiles),
			maxTotalBytes,
			systemLong("visiblefunction.recording.minFreeBytes", 1024L * 1024 * 1024)
		);
	}

	private static long saturatedAdd(long left, long right) {
		if (Long.MAX_VALUE - left < right) {
			return Long.MAX_VALUE;
		}
		return left + right;
	}

	private static String sanitizeSuffix(String value) {
		String sanitized = value == null ? "" : value.replaceAll("[^A-Za-z0-9_-]", "");
		return sanitized.isBlank() ? UUID.randomUUID().toString().substring(0, 8) : sanitized;
	}

	private static String journalName(String id) {
		return "visiblefunction-recording-" + id + ".journal.tmp";
	}

	private static StringBuilder property(StringBuilder json, String name, String value) {
		json.append('"');
		VisibleFunctionExportJson.appendEscaped(json, name);
		json.append("\":\"");
		VisibleFunctionExportJson.appendEscaped(json, value);
		json.append('"');
		return json;
	}

	private static StringBuilder property(StringBuilder json, String name, long value) {
		json.append('"');
		VisibleFunctionExportJson.appendEscaped(json, name);
		json.append("\":").append(value);
		return json;
	}

	private static StringBuilder property(StringBuilder json, String name, int value) {
		return property(json, name, (long) value);
	}

	private static StringBuilder property(StringBuilder json, String name, boolean value) {
		json.append('"');
		VisibleFunctionExportJson.appendEscaped(json, name);
		json.append("\":").append(value);
		return json;
	}

	private Path recordingFilePath(String id) {
		return recordingDir.resolve("visiblefunction-recording-" + id + ".json");
	}

	private Path recordingJournalFile(String id) {
		return recordingDir.resolve(journalName(id));
	}

	private static String absolutePath(Path path) {
		return path.toAbsolutePath().normalize().toString();
	}

	record RecordingResult(boolean success, String message) {
	}

	record RecordingLimits(
		long maxBytes,
		long maxDurationMillis,
		int maxFiles,
		long maxTotalBytes,
		long minFreeBytes
	) {
		private RecordingLimits validated() {
			if (maxBytes <= FOOTER_RESERVE_BYTES || maxDurationMillis <= 0 || maxFiles <= 0
				|| maxTotalBytes < maxBytes || minFreeBytes < 0) {
				throw new IllegalArgumentException("Invalid VisibleFunction recording limits");
			}
			return this;
		}
	}

	@FunctionalInterface
	interface UsableSpaceProbe {
		long usableSpace(Path path) throws IOException;
	}

	private static final class RecordingSession {
		private final String id;
		private final long startedAtMillis;
		private final Path journalFile;
		private final OutputStream output;
		private final long completedBytesAtStart;
		private final TickFilterEngine<ExportRecord> tickFilter = recordingTickFilter();
		private boolean firstRecord = true;
		private int recordCount;
		private long bytesWritten;
		private long bytesAtLastDiskCheck;
		private long currentTick;

		private RecordingSession(
			String id,
			long startedAtMillis,
			Path journalFile,
			OutputStream output,
			long completedBytesAtStart
		) {
			this.id = id;
			this.startedAtMillis = startedAtMillis;
			this.journalFile = journalFile;
			this.output = output;
			this.completedBytesAtStart = completedBytesAtStart;
		}

		private void writeHeader() throws IOException {
			StringBuilder header = new StringBuilder(192);
			header.append("{\"journal\":{");
			property(header, "format", JOURNAL_FORMAT_V3).append(',');
			property(header, "id", id).append(',');
			property(header, "startedAtMillis", startedAtMillis);
			header.append("},\"records\":[\n");
			byte[] bytes = header.toString().getBytes(StandardCharsets.UTF_8);
			output.write(bytes);
			output.flush();
			bytesWritten += bytes.length;
			bytesAtLastDiskCheck = bytesWritten;
		}

		private byte[] encodeRecord(ExportRecord record) {
			String prefix = firstRecord ? "" : ",";
			return (prefix + VisibleFunctionExportJson.record(record) + "\n").getBytes(StandardCharsets.UTF_8);
		}

		private void append(ExportRecord record, byte[] encoded) throws IOException {
			output.write(encoded);
			bytesWritten += encoded.length;
			firstRecord = false;
			recordCount++;
			TickFilterEngine.Input<ExportRecord> input = VisibleFunctionExportJson.tickFilterInput(record);
			tickFilter.add(input);
			currentTick = Math.max(currentTick, input.tick());
			if (recordCount % RECORDING_FLUSH_INTERVAL == 0) {
				output.flush();
			}
		}

		private boolean shouldCheckDisk(int nextRecordBytes) {
			long projectedBytes = saturatedAdd(bytesWritten, nextRecordBytes);
			return recordCount == 0
				|| recordCount % RECORDING_FLUSH_INTERVAL == 0
				|| projectedBytes - bytesAtLastDiskCheck >= DISK_CHECK_INTERVAL_BYTES;
		}

		private void markDiskChecked() {
			bytesAtLastDiskCheck = bytesWritten;
		}

		private JournalScan scan() {
			return new JournalScan(
				new JournalMetadata(id, startedAtMillis),
				recordCount,
				tickFilter.snapshots(currentTick),
				bytesWritten
			);
		}

		private String id() {
			return id;
		}

		private long startedAtMillis() {
			return startedAtMillis;
		}

		private Path journalFile() {
			return journalFile;
		}

		private int recordCount() {
			return recordCount;
		}

		private long bytesWritten() {
			return bytesWritten;
		}

		private long completedBytesAtStart() {
			return completedBytesAtStart;
		}

		private void close() throws IOException {
			output.flush();
			output.close();
			force(journalFile);
		}

		private void closeQuietly() {
			try {
				output.close();
			} catch (IOException ignored) {
			}
		}
	}

	private record JournalMetadata(String id, long startedAtMillis) {
	}

	private record JournalScan(
		JournalMetadata metadata,
		int records,
		List<TickFilterEngine.Snapshot<ExportRecord>> tickFilter,
		long lastGoodOffset
	) {
	}

	private record DirectoryStats(int fileCount, long totalBytes) {
	}

	private record CompletedRecording(
		String id,
		long startedAtMillis,
		long endedAtMillis,
		Path file,
		int recordCount,
		long sizeBytes,
		boolean recovered,
		String stopReason
	) {
	}
}
