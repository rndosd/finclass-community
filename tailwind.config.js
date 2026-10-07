module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Finclass NanumSquareNeo',
          'Pretendard',
          'Apple SD Gothic Neo',
          'Malgun Gothic',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        // (선택사항) 계약서용 폰트가 필요하다면 추가
        serif: ['Batang', 'Times New Roman', 'serif'],
        handwriting: ['Nanum Pen Script', 'cursive'], // 도장 폰트용 (필요시)
      },
      colors: {
        primary: {
          50: '#f8faff',
          100: '#eef3fb',
          200: '#d9e7f8',
          300: '#b7d1f3',
          400: '#7fb0eb',
          500: '#4c8de0',
          600: '#3b7ac7',
        },
        sky: {
          25: '#f7f9ff',
          50: '#f0f4ff',
          75: '#e8f0ff',
        },
      },
      // ✅ 애니메이션 유틸리티 추가
      animation: {
        'slide-up': 'slide-up 0.3s ease-out',
        'fade-in': 'fade-in 0.2s ease-out',
        'stamp': 'stamp 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards', // 👈 도장 쾅! 효과
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite', // (선택) 천천히 깜빡임
      },
      // ✅ 키프레임 정의 추가
      keyframes: {
        'slide-up': {
          '0%': {
            transform: 'translateY(100%)',
            opacity: '0'
          },
          '100%': {
            transform: 'translateY(0)',
            opacity: '1'
          },
        },
        'fade-in': {
          '0%': {
            opacity: '0'
          },
          '100%': {
            opacity: '1'
          },
        },
        // 👈 도장 애니메이션 키프레임
        'stamp': {
          '0%': {
            transform: 'scale(3)',
            opacity: '0'
          },
          '50%': {
            transform: 'scale(0.9)',
            opacity: '1'
          },
          '100%': {
            transform: 'scale(1)',
            opacity: '1'
          },
        }
      },
    },
  },
  plugins: [],
};