const fs = require('fs');
let content = fs.readFileSync('src/App.jsx', 'utf8');
const old = `Math.floor(profile.height/12) + "'" + (profile.height%12) + '"'`;
const rep = `profile.height>12?Math.floor(profile.height/12)+"'"+(profile.height%12)+'\"':Math.floor(profile.height)+"'"+Math.round((profile.height%1)*12)+'\"'`;
content = content.replace(old, rep);
fs.writeFileSync('src/App.jsx', content);
console.log('Replacements done');
