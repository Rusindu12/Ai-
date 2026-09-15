const fs = require('fs');

function createSimplePNG(width, height) {
  // A minimal valid PNG generator or simple base64 PNG
  // 1x1 purple pixel PNG base64:
  // "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  const buf = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkWL6/HgAFgwI+X7Z/xQAAAABJRU5ErkJggg==", 'base64');
  return buf;
}

fs.writeFileSync('public/icon-192.png', createSimplePNG(192, 192));
fs.writeFileSync('public/icon-512.png', createSimplePNG(512, 512));
console.log('Icons generated');
