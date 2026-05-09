const fs = require('fs');
let c = fs.readFileSync('src/AdminDashboard.jsx', 'utf8');

// Find exact header button section
const idx = c.indexOf('<button onClick={fetchData}');
const end = c.indexOf('</div>\n      <div style={s.inner}>', idx);
const headerControls = c.substring(idx, end);
console.log('Found:', headerControls.substring(0, 100));
