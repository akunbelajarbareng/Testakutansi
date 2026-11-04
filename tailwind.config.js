/** @type {import('tailwindcss').Config} */
// Token warna Oriental: biru tua (navy) + oranye sebagai warna utama brand.
// Ubah di sini saja bila palet resmi berubah — seluruh UI mengikuti.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#13294B', 700: '#1C3863', 600: '#2A4A7A', 100: '#E6ECF5' },
        orange: { DEFAULT: '#E8741A', 600: '#C95F0E', 100: '#FDEEDF' },
        paper: '#F5F6F8',
        line: '#DCE1E8',
        ink: { DEFAULT: '#1B2330', soft: '#5B6677' },
        ok: { DEFAULT: '#0E7C70', 100: '#DDF2EE' },
        bad: { DEFAULT: '#B8322A', 100: '#FBE4E1' },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
