/** Tailwind compilé avec l'application (auparavant chargé depuis cdn.tailwindcss.com à chaque ouverture). */
export default {
  darkMode: 'class',
  content: ['./index.html', './App.tsx', './index.tsx', './components/**/*.tsx', './services/**/*.ts', './lib/**/*.ts'],
  theme: {
    extend: {
      colors: {
        studio: {
          950: '#070A10',
          900: '#0B0F17',
          850: '#0E1524',
          800: '#131B2E',
          700: '#1E293B',
          600: '#334155',
          accent: '#6366F1',
          cyan: '#06B6D4',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
