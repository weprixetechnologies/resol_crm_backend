const ExcelJS = require('exceljs');
const path = require('path');

async function generateTestExcel() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Random Countries Test');

  // Define Columns
  worksheet.columns = [
    { header: 'Name', key: 'name', width: 22 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Mobile', key: 'mobile', width: 16 },
    { header: 'ISD Code', key: 'isd_code', width: 12 },
    { header: 'City', key: 'city', width: 16 },
    { header: 'State', key: 'state', width: 16 },
    { header: 'Designation', key: 'designation', width: 22 },
    { header: 'Institute', key: 'institute', width: 28 },
    { header: 'Department', key: 'department', width: 20 },
    { header: 'Country', key: 'country', width: 25 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Tag 1', key: 'tag1', width: 18 },
    { header: 'Tag 2', key: 'tag2', width: 18 },
    { header: 'Remark', key: 'remark', width: 32 }
  ];

  const sampleRows = [
    { name: 'John Doe', email: 'test.country.1@example.com', mobile: '9900000001', isd_code: '+1', city: 'New York', state: 'NY', designation: 'Developer', institute: 'Tech Corp', department: 'IT', country: 'America', status: 'active', tag1: 'Test', tag2: 'CountryCheck', remark: 'Verifying America' },
    { name: 'Alex Smith', email: 'test.country.2@example.com', mobile: '9900000002', isd_code: '+1', city: 'Chicago', state: 'IL', designation: 'Analyst', institute: 'Data Co', department: 'Analytics', country: 'Amrika', status: 'active', tag1: 'Test', tag2: 'CountryCheck', remark: 'Verifying misspelling Amrika' },
    { name: 'Maria Garcia', email: 'test.country.3@example.com', mobile: '9900000003', isd_code: '+1', city: 'Houston', state: 'TX', designation: 'Manager', institute: 'Global Inc', department: 'Sales', country: 'Unite Stast of Ameria', status: 'active', tag1: 'Test', tag2: 'CountryCheck', remark: 'Verifying Unite Stast of Ameria' },
    { name: 'Rohan Sharma', email: 'test.country.4@example.com', mobile: '9900000004', isd_code: '+91', city: 'Delhi', state: 'DL', designation: 'Engineer', institute: 'Info Tech', department: 'R&D', country: 'Indiya', status: 'active', tag1: 'Test', tag2: 'CountryCheck', remark: 'Verifying Indiya' },
    { name: 'Pooja Patel', email: 'test.country.5@example.com', mobile: '9900000005', isd_code: '+91', city: 'Ahmedabad', state: 'GJ', designation: 'Architect', institute: 'Design Studio', department: 'Design', country: 'Indi-a!', status: 'active', tag1: 'Test', tag2: 'CountryCheck', remark: 'Verifying Indi-a! with symbols' },
    { name: 'David Brown', email: 'test.country.6@example.com', mobile: '9900000006', isd_code: '+44', city: 'London', state: 'Greater London', designation: 'Director', institute: 'UK Finance', department: 'Finance', country: 'United Kingdom of Great Britain', status: 'active', tag1: 'Test', tag2: 'CountryCheck', remark: 'Verifying long country string' },
    { name: 'Emma Wilson', email: 'test.country.7@example.com', mobile: '9900000007', isd_code: '+44', city: 'Manchester', state: 'Greater Manchester', designation: 'Lead', institute: 'Media Hub', department: 'Marketing', country: 'Englad', status: 'active', tag1: 'Test', tag2: 'CountryCheck', remark: 'Verifying Englad' },
    { name: 'Hans Mueller', email: 'test.country.8@example.com', mobile: '9900000008', isd_code: '+49', city: 'Berlin', state: 'Berlin', designation: 'Scientist', institute: 'Research Inst', department: 'Lab', country: 'Deutscland', status: 'active', tag1: 'Test', tag2: 'CountryCheck', remark: 'Verifying Deutscland' },
    { name: 'Carlos Gomez', email: 'test.country.9@example.com', mobile: '9900000009', isd_code: '+34', city: 'Madrid', state: 'Madrid', designation: 'Consultant', institute: 'Iberia Group', department: 'Strategy', country: 'Espanya', status: 'active', tag1: 'Test', tag2: 'CountryCheck', remark: 'Verifying Espanya' },
    { name: 'Kenji Sato', email: 'test.country.10@example.com', mobile: '9900000010', isd_code: '+81', city: 'Tokyo', state: 'Kanto', designation: 'Specialist', institute: 'Tokyo Systems', department: 'Ops', country: 'Japn', status: 'active', tag1: 'Test', tag2: 'CountryCheck', remark: 'Verifying Japn' },
    { name: 'Sophie Martin', email: 'test.country.11@example.com', mobile: '9900000011', isd_code: '+1', city: 'Toronto', state: 'Ontario', designation: 'Lead Architect', institute: 'Maple Tech', department: 'Eng', country: 'Caneda', status: 'active', tag1: 'Test', tag2: 'CountryCheck', remark: 'Verifying Caneda' },
    { name: 'Liam Neeson', email: 'test.country.12@example.com', mobile: '9900000012', isd_code: '+61', city: 'Sydney', state: 'NSW', designation: 'Advisor', institute: 'Pacific Ltd', department: 'Advisory', country: 'Austrelia', status: 'active', tag1: 'Test', tag2: 'CountryCheck', remark: 'Verifying Austrelia' },
    { name: 'Tan Wei', email: 'test.country.13@example.com', mobile: '9900000013', isd_code: '+65', city: 'Singapore', state: 'SG', designation: 'Executive', institute: 'Lion Corp', department: 'Exec', country: 'Singaporrr', status: 'active', tag1: 'Test', tag2: 'CountryCheck', remark: 'Verifying Singaporrr' },
    { name: 'Lucas Silva', email: 'test.country.14@example.com', mobile: '9900000014', isd_code: '+55', city: 'Sao Paulo', state: 'SP', designation: 'Coordinator', institute: 'Samba Logistics', department: 'Supply', country: 'Braazil', status: 'active', tag1: 'Test', tag2: 'CountryCheck', remark: 'Verifying Braazil' },
    { name: 'Thabo Mbeki', email: 'test.country.15@example.com', mobile: '9900000015', isd_code: '+27', city: 'Johannesburg', state: 'Gauteng', designation: 'VP Sales', institute: 'Safari Energy', department: 'Sales', country: 'South Africa (SA)', status: 'active', tag1: 'Test', tag2: 'CountryCheck', remark: 'Verifying South Africa (SA)' },
    { name: 'Oliver Twist', email: 'test.country.16@example.com', mobile: '9900000016', isd_code: '+64', city: 'Auckland', state: 'Auckland', designation: 'DevOps', institute: 'Kiwi Cloud', department: 'Cloud', country: 'New Zeeland', status: 'active', tag1: 'Test', tag2: 'CountryCheck', remark: 'Verifying New Zeeland' },
    { name: 'Beat Zuber', email: 'test.country.17@example.com', mobile: '9900000017', isd_code: '+41', city: 'Zurich', state: 'Zurich', designation: 'Treasurer', institute: 'Alpine Bank', department: 'Treasury', country: 'Switzerlaand', status: 'active', tag1: 'Test', tag2: 'CountryCheck', remark: 'Verifying Switzerlaand' },
    { name: 'Tariq Mansoor', email: 'test.country.18@example.com', mobile: '9900000018', isd_code: '+971', city: 'Dubai', state: 'Dubai', designation: 'Partner', institute: 'Emirates Trade', department: 'Trade', country: 'UAE / Dubai', status: 'active', tag1: 'Test', tag2: 'CountryCheck', remark: 'Verifying UAE / Dubai' },
    { name: 'Dmitry Ivanov', email: 'test.country.19@example.com', mobile: '9900000019', isd_code: '+7', city: 'Moscow', state: 'Moscow', designation: 'Senior Lead', institute: 'EuroAsia Soft', department: 'Software', country: 'Rusia', status: 'active', tag1: 'Test', tag2: 'CountryCheck', remark: 'Verifying Rusia' },
    { name: 'Mateo Lopez', email: 'test.country.20@example.com', mobile: '9900000020', isd_code: '+52', city: 'Mexico City', state: 'CDMX', designation: 'Product Lead', institute: 'Aztec Digital', department: 'Product', country: 'Mexicooo', status: 'active', tag1: 'Test', tag2: 'CountryCheck', remark: 'Verifying Mexicooo' }
  ];

  sampleRows.forEach(row => worksheet.addRow(row));

  // Style Header Row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4F46E5' }
  };
  headerRow.height = 24;

  const outputPath = path.join(__dirname, '../../random_countries_import.xlsx');
  await workbook.xlsx.writeFile(outputPath);

  console.log(`Successfully generated test Excel file at: ${outputPath}`);
}

generateTestExcel().catch(err => {
  console.error('Error generating Excel file:', err);
  process.exit(1);
});
