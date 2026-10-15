// Dev renderer URL. Override the port with TELLAFLOW_DEV_PORT when 5173 is taken.
const DEV_PORT = Number(process.env.TELLAFLOW_DEV_PORT) || 5173;

function devUrl(page) {
  return `http://localhost:${DEV_PORT}/${page}`;
}

module.exports = { DEV_PORT, devUrl };
