const fs = require('fs');
let content = fs.readFileSync('src/App.jsx', 'utf8');

// Fix all height display instances
const oldPattern = /Math\.floor\(profile\.height\/12\)\s*\+\s*["'`]'["'`]\s*\+\s*\(profile\.height%12\)\s*\+\s*["'`]"["'`]/g;
const newVal = 'profile.height>12?Math.floor(profile.height/12)+"\'"+Math.round(profile.height%12)+"\\"":Math.floor(profile.height)+"\'"+Math.round((profile.height%1)*12)+"\\""';
content = content.replace(oldPattern, newVal);

fs.writeFileSync('src/App.jsx', content);
console.log('Done');
