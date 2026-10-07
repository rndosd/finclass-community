import * as XLSX from "xlsx";

const MEBIBYTE = 1024 * 1024;

export const XLSX_IMPORT_ACCEPT =
  ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const DEFAULT_XLSX_IMPORT_LIMITS = Object.freeze({
  maxFileBytes: 2 * MEBIBYTE,
  maxExpandedBytes: 20 * MEBIBYTE,
  maxZipEntries: 200,
  maxCompressionRatio: 100,
  maxSheets: 10,
  maxDataRows: 2000,
  maxColumns: 50,
  maxCells: 100000,
  maxCellCharacters: 10000,
});

const ACCEPTED_MIME_TYPES = new Set([
  "",
  "application/octet-stream",
  "application/zip",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

const ZIP_SIGNATURES = new Set(["504b0304", "504b0506", "504b0708"]);
const ZIP_CENTRAL_FILE_SIGNATURE = 0x02014b50;
const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_END_MIN_BYTES = 22;
const ZIP_MAX_COMMENT_BYTES = 0xffff;

const decodeZipEntryName = (bytes) => {
  let decoded = "";
  for (const byte of bytes) decoded += String.fromCharCode(byte);
  return decoded;
};

export class XlsxImportBoundaryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "XlsxImportBoundaryError";
    this.code = code;
  }
}

const resolveLimits = (overrides = {}) => ({
  ...DEFAULT_XLSX_IMPORT_LIMITS,
  ...overrides,
});

const boundaryError = (code, message) => {
  throw new XlsxImportBoundaryError(code, message);
};

export const validateXlsxImportFile = (file, limitOverrides = {}) => {
  const limits = resolveLimits(limitOverrides);
  const normalizedName = String(file?.name || "").trim().toLowerCase();
  const normalizedType = String(file?.type || "").trim().toLowerCase();
  const fileSize = Number(file?.size);

  if (!file || !normalizedName.endsWith(".xlsx")) {
    boundaryError("invalid_extension", "매크로가 없는 .xlsx 파일만 업로드할 수 있습니다.");
  }
  if (Number.isFinite(fileSize) && fileSize <= 0) {
    boundaryError("empty_file", "빈 엑셀 파일은 업로드할 수 없습니다.");
  }
  if (Number.isFinite(fileSize) && fileSize > limits.maxFileBytes) {
    boundaryError(
      "file_too_large",
      `엑셀 파일은 ${Math.floor(limits.maxFileBytes / MEBIBYTE)}MB 이하여야 합니다.`,
    );
  }
  if (!ACCEPTED_MIME_TYPES.has(normalizedType)) {
    boundaryError("invalid_mime", "엑셀 파일 형식을 확인해 주세요.");
  }

  return limits;
};

const validateZipSignature = (arrayBuffer) => {
  if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength < 4) {
    boundaryError("invalid_container", "올바른 .xlsx 파일이 아닙니다.");
  }

  const signature = Array.from(new Uint8Array(arrayBuffer, 0, 4))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

  if (!ZIP_SIGNATURES.has(signature)) {
    boundaryError("invalid_container", "올바른 .xlsx 파일이 아닙니다.");
  }
};

const findZipEndOffset = (view) => {
  const minimumOffset = Math.max(
    0,
    view.byteLength - ZIP_END_MIN_BYTES - ZIP_MAX_COMMENT_BYTES,
  );

  for (
    let offset = view.byteLength - ZIP_END_MIN_BYTES;
    offset >= minimumOffset;
    offset -= 1
  ) {
    if (view.getUint32(offset, true) === ZIP_END_SIGNATURE) return offset;
  }

  boundaryError("invalid_container", "올바른 .xlsx ZIP 구조가 아닙니다.");
};

const validateZipContainer = (arrayBuffer, limits) => {
  const view = new DataView(arrayBuffer);
  const zipEndOffset = findZipEndOffset(view);
  const entryCount = view.getUint16(zipEndOffset + 10, true);
  const centralDirectoryBytes = view.getUint32(zipEndOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(zipEndOffset + 16, true);
  const commentBytes = view.getUint16(zipEndOffset + 20, true);

  if (
    entryCount === 0xffff ||
    centralDirectoryBytes === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    boundaryError("zip64_not_allowed", "ZIP64 형식의 엑셀 파일은 업로드할 수 없습니다.");
  }
  if (entryCount > limits.maxZipEntries) {
    boundaryError(
      "too_many_zip_entries",
      `엑셀 내부 파일은 ${limits.maxZipEntries}개 이하여야 합니다.`,
    );
  }
  if (
    zipEndOffset + ZIP_END_MIN_BYTES + commentBytes > view.byteLength ||
    centralDirectoryOffset + centralDirectoryBytes > zipEndOffset
  ) {
    boundaryError("invalid_container", "엑셀 ZIP 구조가 올바르지 않습니다.");
  }

  const fileNames = new Set();
  let cursor = centralDirectoryOffset;
  let totalCompressedBytes = 0;
  let totalExpandedBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (
      cursor + 46 > view.byteLength ||
      view.getUint32(cursor, true) !== ZIP_CENTRAL_FILE_SIGNATURE
    ) {
      boundaryError("invalid_container", "엑셀 내부 파일 목록이 올바르지 않습니다.");
    }

    const flags = view.getUint16(cursor + 8, true);
    const compressedBytes = view.getUint32(cursor + 20, true);
    const expandedBytes = view.getUint32(cursor + 24, true);
    const fileNameBytes = view.getUint16(cursor + 28, true);
    const extraBytes = view.getUint16(cursor + 30, true);
    const entryCommentBytes = view.getUint16(cursor + 32, true);
    const entryBytes = 46 + fileNameBytes + extraBytes + entryCommentBytes;

    if (
      compressedBytes === 0xffffffff ||
      expandedBytes === 0xffffffff ||
      cursor + entryBytes > view.byteLength
    ) {
      boundaryError("invalid_container", "지원하지 않는 엑셀 ZIP 항목입니다.");
    }
    if ((flags & 0x1) !== 0) {
      boundaryError("encrypted_file", "암호화된 엑셀 파일은 업로드할 수 없습니다.");
    }

    const fileNameStart = cursor + 46;
    const fileName = decodeZipEntryName(
      new Uint8Array(arrayBuffer, fileNameStart, fileNameBytes),
    )
      .replace(/\\/g, "/")
      .toLowerCase();

    if (
      fileName.startsWith("/") ||
      fileName.split("/").includes("..") ||
      fileName.includes("\0")
    ) {
      boundaryError("unsafe_entry_name", "안전하지 않은 엑셀 내부 경로가 있습니다.");
    }
    if (
      fileName === "xl/vbaproject.bin" ||
      fileName.startsWith("xl/externallinks/") ||
      fileName.startsWith("xl/embeddings/") ||
      fileName.startsWith("customui/")
    ) {
      boundaryError(
        "active_content_not_allowed",
        "매크로·외부 연결·삽입 개체가 포함된 엑셀 파일은 업로드할 수 없습니다.",
      );
    }

    const entryCompressionRatio =
      expandedBytes === 0
        ? 1
        : expandedBytes / Math.max(compressedBytes, 1);
    if (entryCompressionRatio > limits.maxCompressionRatio) {
      boundaryError(
        "compression_ratio_too_high",
        "압축률이 비정상적으로 높은 엑셀 파일은 업로드할 수 없습니다.",
      );
    }

    totalCompressedBytes += compressedBytes;
    totalExpandedBytes += expandedBytes;
    if (totalExpandedBytes > limits.maxExpandedBytes) {
      boundaryError(
        "expanded_file_too_large",
        `압축 해제된 엑셀 데이터는 ${Math.floor(limits.maxExpandedBytes / MEBIBYTE)}MB 이하여야 합니다.`,
      );
    }

    fileNames.add(fileName);
    cursor += entryBytes;
  }

  const totalCompressionRatio =
    totalExpandedBytes === 0
      ? 1
      : totalExpandedBytes / Math.max(totalCompressedBytes, 1);
  if (totalCompressionRatio > limits.maxCompressionRatio) {
    boundaryError(
      "compression_ratio_too_high",
      "압축률이 비정상적으로 높은 엑셀 파일은 업로드할 수 없습니다.",
    );
  }
  if (
    !fileNames.has("[content_types].xml") ||
    !fileNames.has("xl/workbook.xml")
  ) {
    boundaryError("invalid_xlsx_structure", "올바른 .xlsx 문서 구조가 아닙니다.");
  }
};

const validateWorksheetRange = (worksheet, limits) => {
  const rangeRef = worksheet?.["!fullref"] || worksheet?.["!ref"];
  if (!rangeRef) return;

  let range;
  try {
    range = XLSX.utils.decode_range(rangeRef);
  } catch {
    boundaryError("invalid_range", "엑셀 시트 범위가 올바르지 않습니다.");
  }

  const rowCount = range.e.r - range.s.r + 1;
  const columnCount = range.e.c - range.s.c + 1;

  if (rowCount > limits.maxDataRows + 1) {
    boundaryError(
      "too_many_rows",
      `엑셀 데이터는 머리글을 제외하고 ${limits.maxDataRows}행 이하여야 합니다.`,
    );
  }
  if (columnCount > limits.maxColumns) {
    boundaryError(
      "too_many_columns",
      `엑셀 데이터는 ${limits.maxColumns}열 이하여야 합니다.`,
    );
  }
};

const validateWorksheetCells = (worksheet, limits) => {
  const cells = Object.entries(worksheet || {}).filter(
    ([address]) => !address.startsWith("!"),
  );

  if (cells.length > limits.maxCells) {
    boundaryError(
      "too_many_cells",
      `엑셀 데이터 셀은 ${limits.maxCells.toLocaleString("ko-KR")}개 이하여야 합니다.`,
    );
  }

  for (const [, cell] of cells) {
    if (typeof cell?.f === "string" && cell.f.trim()) {
      boundaryError(
        "formula_not_allowed",
        "수식이 포함된 엑셀 파일은 업로드할 수 없습니다. 값으로 붙여넣은 뒤 다시 시도해 주세요.",
      );
    }

    const hyperlinkTarget = String(cell?.l?.Target || "").trim();
    if (hyperlinkTarget && !hyperlinkTarget.startsWith("#")) {
      boundaryError(
        "external_link_not_allowed",
        "외부 링크가 포함된 엑셀 파일은 업로드할 수 없습니다.",
      );
    }

    if (
      typeof cell?.v === "string" &&
      cell.v.length > limits.maxCellCharacters
    ) {
      boundaryError(
        "cell_too_long",
        `셀 하나의 텍스트는 ${limits.maxCellCharacters.toLocaleString("ko-KR")}자 이하여야 합니다.`,
      );
    }
  }
};

export const parseFirstXlsxWorksheet = (
  arrayBuffer,
  {
    file,
    limits: limitOverrides,
    sheetToJsonOptions = { defval: "" },
  } = {},
) => {
  const limits = file
    ? validateXlsxImportFile(file, limitOverrides)
    : resolveLimits(limitOverrides);

  if (arrayBuffer?.byteLength > limits.maxFileBytes) {
    boundaryError(
      "file_too_large",
      `엑셀 파일은 ${Math.floor(limits.maxFileBytes / MEBIBYTE)}MB 이하여야 합니다.`,
    );
  }
  validateZipSignature(arrayBuffer);
  validateZipContainer(arrayBuffer, limits);

  let workbook;
  try {
    workbook = XLSX.read(arrayBuffer, {
      type: "array",
      sheets: 0,
      sheetRows: limits.maxDataRows + 1,
      cellFormula: true,
      cellHTML: false,
      cellStyles: false,
      bookDeps: false,
      bookFiles: false,
      bookVBA: false,
    });
  } catch (error) {
    if (error instanceof XlsxImportBoundaryError) throw error;
    boundaryError("parse_failed", "올바른 .xlsx 파일인지 확인해 주세요.");
  }

  if (!workbook.SheetNames?.length) {
    boundaryError("missing_sheet", "엑셀 시트를 찾을 수 없습니다.");
  }
  if (workbook.SheetNames.length > limits.maxSheets) {
    boundaryError(
      "too_many_sheets",
      `엑셀 시트는 ${limits.maxSheets}개 이하여야 합니다.`,
    );
  }

  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!worksheet) {
    boundaryError("missing_sheet", "첫 번째 엑셀 시트를 읽을 수 없습니다.");
  }

  validateWorksheetRange(worksheet, limits);
  validateWorksheetCells(worksheet, limits);

  const rows = XLSX.utils.sheet_to_json(worksheet, sheetToJsonOptions);
  if (rows.length > limits.maxDataRows) {
    boundaryError(
      "too_many_rows",
      `엑셀 데이터는 머리글을 제외하고 ${limits.maxDataRows}행 이하여야 합니다.`,
    );
  }

  return { workbook, worksheet, rows };
};

export const getXlsxImportErrorMessage = (
  error,
  fallback = "엑셀 파일을 읽는 중 오류가 발생했습니다.",
) => (error instanceof XlsxImportBoundaryError ? error.message : fallback);
