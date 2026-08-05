/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        chart: {
          bg: '#0f1117',
          panel: '#131722',
          border: '#2d3748',
          text: '#9ca3af',
          bull: '#22c55e',
          bear: '#ef4444',
        },
      },
    },
  },
  plugins: [],
}
