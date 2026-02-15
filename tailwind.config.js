/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./panel/**/*.{html,js}', './popup/**/*.{html,js}', './src/**/*.js'],
  corePlugins: {
    preflight: false
  },
  theme: {
    extend: {}
  },
  plugins: []
};
