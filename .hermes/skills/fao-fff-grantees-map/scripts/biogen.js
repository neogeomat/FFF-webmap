// Byte-identity probe for the popup card generators in Webmap/js/myFuncs.js.
// Run before AND after a refactor of bio_table_generator / bio_details_generator, then compare:
//   node biogen.js > /tmp/biogen_before.txt ... node biogen.js > /tmp/biogen_after.txt
//   awk '/^=== bio_table_generator ===$/,/^=== null ===$/' /tmp/biogen_{before,after}.txt | md5sum
// The bio_table_generator + null sections MUST match; only the bio_details_generator section (new
// function, '(missing)' before) may differ. Requires the site served on http://localhost:6115.
const { chromium } = require('playwright');
const FEATURE = { properties: {
  S_N: 7, Name_of_Organization: 'Test Org <script>', Location: 'L', Type_of_Grant: 'LoA',
  Commodities: 'Ginger', enterprise_classifications: ['Integrated'],
  grants: [{ grant_title: 'G', implementation_period: 'P', enterprise_classification: 'Integrated', subcategory: 'Ginger' }],
  restoration: [{ year_block: 'Y', area_direct_ha: 1, area_contributed_ha: 2, people_benefited: 3 }],
  women: [{ producer_group: 'W', women_count: 4, product: 'Ginger' }]
} };
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.goto('http://localhost:6115', { waitUntil: 'domcontentloaded', timeout: 45000 });
  const out = await p.evaluate((f) => ({
    table: bio_table_generator(f),
    empty: bio_table_generator(null),
    details: typeof bio_details_generator === 'function' ? bio_details_generator(f) : '(missing)'
  }), FEATURE);
  console.log('=== bio_table_generator ===');
  console.log(out.table);
  console.log('=== null ===');
  console.log(out.empty);
  console.log('=== bio_details_generator ===');
  console.log(out.details);
  await b.close();
})();
