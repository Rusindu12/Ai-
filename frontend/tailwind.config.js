/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#0b0e14',
          light: '#ffffff',
        },
        accent: {
          DEFAULT: '#3b82f6',
          green: '#10b981',
          red: '#ef4444',
        },
      },
    },
  },
  plugins: [],
};
