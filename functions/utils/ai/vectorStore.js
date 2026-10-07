const admin = require('../../firebaseAdminCompat');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const db = admin.firestore();

// ✅ 함수 인자로 apiKey를 받습니다.
exports.searchManual = async (apiKey, userQuery) => {
    if (!apiKey) return ""; 

    try {
    // 그때그때 인스턴스 생성 (가볍기 때문에 성능 문제 없음)
        const genAI = new GoogleGenerativeAI(apiKey);
        const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

        const result = await embeddingModel.embedContent(userQuery);
        const queryVector = result.embedding.values;

        const coll = db.collection('manual_vectors');
        const snapshot = await coll.findNearest('embedding', queryVector, {
            limit: 3,
            distanceMeasure: 'COSINE'
        }).get();

        if (snapshot.empty) return null;

        return snapshot.docs.map(doc => {
            const data = doc.data();
            return `[${data.metadata?.title || '가이드'}]\n${data.content}`;
        }).join("\n---\n");

    } catch (error) {
        console.error("Vector Search Error:", error);
        return "";
    }
};