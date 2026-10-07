// src/utils/uploadToR2.js

import { getFunctions, httpsCallable } from 'firebase/functions';

export const uploadToR2 = async (file, uploadType = 'newsImage', onProgress = null) => {
    try {
        const functions = getFunctions(undefined, 'asia-northeast3'); // 리전 추가
        const getUploadUrl = httpsCallable(functions, 'getUploadUrl');

        const result = await getUploadUrl({
            fileName: file.name,
            fileType: file.type,
            uploadType: uploadType,
        });

        const { uploadUrl, fileUrl, fileName } = result.data;

        await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            if (onProgress) {
                xhr.upload.addEventListener('progress', (e) => {
                    if (e.lengthComputable) {
                        const percentComplete = Math.round((e.loaded / e.total) * 100);
                        onProgress(percentComplete);
                    }
                });
            }

            xhr.open('PUT', uploadUrl);
            xhr.setRequestHeader('Content-Type', file.type);

            xhr.onload = () => {
                if (xhr.status === 200) {
                    resolve();
                } else {
                    reject(new Error(`업로드 실패: ${xhr.status}`));
                }
            };

            xhr.onerror = () => reject(new Error('업로드 중 오류 발생'));

            xhr.send(file);
        });

        return { fileUrl, fileName };
    } catch (error) {
        console.error('Upload error:', error);
        throw error;
    }
};

export const deleteFromR2 = async (fileName) => {
    try {
        const functions = getFunctions(undefined, 'asia-northeast3'); // 리전 추가
        const deleteFile = httpsCallable(functions, 'deleteFile');

        await deleteFile({ fileName });
    } catch (error) {
        console.error('Delete error:', error);
        throw error;
    }
};