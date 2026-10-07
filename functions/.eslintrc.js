module.exports = {
    root: true,
    env: {
        node: true,
        es2021: true,
    },
    parserOptions: {
        ecmaVersion: 12,
        sourceType: 'module',
    },
    ignorePatterns: ['.eslintrc.js'],
    overrides: [{
        files: ['src/store.js'],
        rules: { 'no-undef': 'error' },
    }],

    rules: {
        // 들여쓰기 오류는 경고로, 4스페이스 유지
        'indent': ['warn', 4],

        // 최대 줄 길이: 140자로 완화 + 경고 처리
        'max-len': ['warn', { code: 140, ignoreComments: true }],

        // 객체 중괄호 사이 공백 강제 없음
        'object-curly-spacing': ['warn', 'always'],

        // 여러 칸 띄어쓰기 허용
        'no-multi-spaces': 'off',

        // 끝 콤마 관련 제한 해제
        'comma-dangle': 'off',

        // console.log 허용 (기본은 경고)
        'no-console': 'off',

        // 변수 안 쓰는 경우도 허용
        'no-unused-vars': 'warn',
    },
};
