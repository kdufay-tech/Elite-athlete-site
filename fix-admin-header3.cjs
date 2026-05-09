const fs = require('fs');
let c = fs.readFileSync('src/AdminDashboard.jsx', 'utf8');

// Fix header to stack vertically on mobile
c = c.replace(
  "header:    { background:'#111', borderBottom:'1px solid #C9A84C1a', padding:'16px', display:'flex', alignItems:'flex-start', justifyContent:'space-between', flexWrap:'wrap', gap:12 },",
  "header:    { background:'#111', borderBottom:'1px solid #C9A84C1a', padding:'16px', display:'flex', flexDirection:'column', gap:12 },"
);

fs.writeFileSync('src/AdminDashboard.jsx', c);
console.log('Done');
