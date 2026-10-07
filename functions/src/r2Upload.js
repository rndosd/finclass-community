const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { defineString, defineSecret } = require("firebase-functions/params");

// ------------------------------------
// 1. 환경 변수 정의
// ------------------------------------
const r2AccountId = defineString("R2_ACCOUNT_ID");
const r2AccessKeyId = defineSecret("R2_ACCESS_KEY_ID");
const r2SecretAccessKey = defineSecret("R2_SECRET_ACCESS_KEY");
const r2BucketName = defineString("R2_BUCKET_NAME");
const r2PublicUrl = defineString("R2_PUBLIC_URL");

// ------------------------------------
// 2. 설정 값 (CORS 및 파일 타입)
// ------------------------------------

// 두 프로젝트 도메인과 로컬호스트를 모두 포함 (CORS 에러 방지)
const ALLOWED_ORIGINS = String(process.env.UPLOAD_ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);

const ALLOWED_FILE_TYPES = {
    newsImage: {
        types: [
            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/gif",
            "image/webp",
            "image/avif",
            "image/avif-sequence",
            "image/heic",
            "image/heif",
            "image/heic-sequence",
            "image/heif-sequence",
        ],
        maxSize: 1 * 1024 * 1024,
        maxGifSize: 2 * 1024 * 1024,
        folder: "news/images",
    },
    newsAttachment: {
        types: [
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/haansofthwp",
        ],
        maxSize: 20 * 1024 * 1024,
        folder: "news/attachments",
    },
    profileImage: {
        types: ["image/jpeg", "image/png", "image/webp"],
        maxSize: 2 * 1024 * 1024,
        folder: "profiles",
    },
    video: {
        types: ["video/mp4", "video/webm"],
        maxSize: 100 * 1024 * 1024,
        folder: "videos",
    },
    signatureImage: {
        types: ["image/png"],
        maxSize: 1 * 1024 * 1024,
        folder: "signatures",
    },
};

const getUserScopedPrefixes = (uid) =>
    Object.values(ALLOWED_FILE_TYPES).map((config) => `${config.folder}/${uid}/`);

const isOwnedFilePath = (fileName, uid) => {
    if (typeof fileName !== "string") return false;
    const normalized = fileName.replace(/\\/g, "/").trim();
    if (!normalized || normalized.includes("..")) return false;
    return getUserScopedPrefixes(uid).some((prefix) =>
        normalized.startsWith(prefix),
    );
};

// ------------------------------------
// 3. 내부 헬퍼 함수
// ------------------------------------

// S3 클라이언트 생성 및 환경변수 검증
const createS3Client = () => {
    // 값 가져오기
    const accountId = r2AccountId.value();
    const accessKey = r2AccessKeyId.value();
    const secretKey = r2SecretAccessKey.value();

    // 필수 환경 변수 체크 (이게 없으면 internal 에러 발생함)
    if (!accountId || !accessKey || !secretKey) {
        console.error("❌ [Critical] R2 환경 변수가 설정되지 않았습니다.");
        console.error(`Status -> AccountID: ${!!accountId}, AccessKey: ${!!accessKey}, SecretKey: ${!!secretKey}`);
        throw new Error("서버 환경 변수 설정 오류");
    }

    return new S3Client({
        region: "auto",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: accessKey,
            secretAccessKey: secretKey,
        },
    });
};

// ------------------------------------
// 4. Cloud Functions (Export)
// ------------------------------------

exports.getUploadUrl = onCall(
    {
        // cors: true, // 만약 아래 배열로도 안 되면, 디버깅을 위해 이 주석을 풀고 배열을 지우세요.
        cors: ALLOWED_ORIGINS,
        secrets: [r2AccessKeyId, r2SecretAccessKey],
    },
    async (request) => {
        console.log("🚀 [Start] getUploadUrl called");

        // 1. 인증 체크
        if (!request.auth) {
            console.warn("⚠️ [Auth] Unauthenticated request");
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        const { fileName, fileType, uploadType = "newsImage" } = request.data;
        console.log(`📂 [Info] User: ${request.auth.uid}, Type: ${uploadType}, File: ${fileName}`);

        // 2. 유효성 검사
        if (!ALLOWED_FILE_TYPES[uploadType]) {
            throw new HttpsError("invalid-argument", "잘못된 업로드 타입입니다.");
        }

        const config = ALLOWED_FILE_TYPES[uploadType];

        if (!config.types.includes(fileType)) {
            console.warn(`⚠️ [Invalid Type] Request: ${fileType}, Allowed: ${config.types.join(", ")}`);
            throw new HttpsError(
                "invalid-argument",
                `허용되지 않는 파일 형식입니다. (${fileType})`
            );
        }

        // 3. 파일 경로 생성
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(2, 8);
        const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9가-힣._-]/g, "_");
        const uniqueFileName = `${config.folder}/${request.auth.uid}/${timestamp}-${randomStr}-${sanitizedFileName}`;

        try {
            // 4. S3 클라이언트 생성 (여기서 환경변수 에러 체크됨)
            const s3Client = createS3Client();

            const command = new PutObjectCommand({
                Bucket: r2BucketName.value(),
                Key: uniqueFileName,
                ContentType: fileType,
            });

            // 5. Presigned URL 생성
            const uploadUrl = await getSignedUrl(s3Client, command, {
                expiresIn: 900, // 15분
            });

            const fileUrl = `${r2PublicUrl.value()}/${uniqueFileName}`;

            console.log("✅ [Success] Presigned URL generated");
            
            return {
                uploadUrl,
                fileUrl,
                fileName: uniqueFileName,
            };

        } catch (error) {
            console.error("❌ [Error] getUploadUrl failed:", error);
            // 클라이언트에게는 internal로 던지되, 메시지는 단순화
            throw new HttpsError("internal", "업로드 URL 생성 중 오류가 발생했습니다.");
        }
    }
);

exports.deleteFile = onCall(
    {
        cors: ALLOWED_ORIGINS,
        secrets: [r2AccessKeyId, r2SecretAccessKey],
    },
    async (request) => {
        console.log("🚀 [Start] deleteFile called");

        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        const { fileName } = request.data || {};
        console.log(`🗑️ [Info] Request to delete: ${fileName}`);

        // 보안: 본인 파일인지 경로로 단순 체크
        if (!isOwnedFilePath(fileName, request.auth.uid)) {
            console.warn("⚠️ [Permission] User tried to delete other's file");
            throw new HttpsError(
                "permission-denied",
                "다른 사용자의 파일은 삭제할 수 없습니다."
            );
        }

        try {
            const s3Client = createS3Client();

            const command = new DeleteObjectCommand({
                Bucket: r2BucketName.value(),
                Key: fileName,
            });

            await s3Client.send(command);
            
            console.log("✅ [Success] File deleted");
            return { success: true, message: "파일이 삭제되었습니다." };

        } catch (error) {
            console.error("❌ [Error] deleteFile failed:", error);
            throw new HttpsError("internal", "파일 삭제에 실패했습니다.");
        }
    }
);
