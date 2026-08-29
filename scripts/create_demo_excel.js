const ExcelJS = require('exceljs');
const path = require('path');

async function createDemoExcel() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Customer Import Demo');

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
    { header: 'Country', key: 'country', width: 16 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Tag 1', key: 'tag1', width: 18 },
    { header: 'Tag 2', key: 'tag2', width: 18 },
    { header: 'Remark', key: 'remark', width: 32 }
  ];

  // Sample Rows
  const sampleRows = [
    {
      name: 'Rajesh Sharma',
      email: 'rajesh.sharma@example.com',
      mobile: '9876543210',
      isd_code: '+91',
      city: 'Mumbai',
      state: 'Maharashtra',
      designation: 'Managing Director',
      institute: 'Apex Solutions Pvt Ltd',
      department: 'Executive Management',
      country: 'India',
      status: 'active',
      tag1: 'VIP',
      tag2: 'Conference2026',
      remark: 'Interested in enterprise license demo'
    },
    {
      name: 'Dr. Ananya Sen',
      email: 'ananya.sen@iitb.ac.in',
      mobile: '9812345678',
      isd_code: '+91',
      city: 'Mumbai',
      state: 'Maharashtra',
      designation: 'Professor & HOD',
      institute: 'IIT Bombay',
      department: 'Computer Science',
      country: 'India',
      status: 'active',
      tag1: 'Academic',
      tag2: 'Speaker',
      remark: 'Keynote speaker for upcoming seminar'
    },
    {
      name: 'Michael Brown',
      email: 'michael.brown@techcorp.io',
      mobile: '4155550199',
      isd_code: '+1',
      city: 'San Francisco',
      state: 'California',
      designation: 'VP of Technology',
      institute: 'Global TechCorp Inc',
      department: 'Engineering',
      country: 'USA',
      status: 'active',
      tag1: 'International',
      tag2: 'Partner',
      remark: 'Global partner lead'
    },
    {
      name: 'Priya Verma',
      email: 'priya.verma@biotech.org',
      mobile: '9711223344',
      isd_code: '+91',
      city: 'Bengaluru',
      state: 'Karnataka',
      designation: 'Senior Researcher',
      institute: 'Institute of Life Sciences',
      department: 'Biotechnology',
      country: 'India',
      status: 'unverified',
      tag1: 'Lead',
      tag2: 'WebForm',
      remark: 'Inquired via public contact form'
    },
    {
      name: 'Vikramaditya Mehta',
      email: 'vikram.mehta@corp.com',
      mobile: '9988776655',
      isd_code: '+91',
      city: 'New Delhi',
      state: 'Delhi',
      designation: 'Chief Commercial Officer',
      institute: 'Mehta Group Industries',
      department: 'Commercial Ops',
      country: 'India',
      status: 'active',
      tag1: 'Enterprise',
      tag2: 'Q3-Opportunity',
      remark: 'Follow up required after initial call'
    }
  ];

  sampleRows.forEach(row => worksheet.addRow(row));

  // Style Header Row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4F46E5' } // Indigo header fill
  };
  headerRow.height = 24;

  // Align cells
  worksheet.eachRow((row, rowNumber) => {
    row.height = rowNumber === 1 ? 24 : 20;
    row.eachCell((cell) => {
      cell.alignment = { vertical: 'middle' };
    });
  });

  const rootPath = path.join(__dirname, '../../customer_import_demo.xlsx');
  const docsPath = path.join(__dirname, '../../docs/demo_import_users.xlsx');

  await workbook.xlsx.writeFile(rootPath);
  await workbook.xlsx.writeFile(docsPath);

  console.log(`SUCCESS: Created Excel demo files at:\n - ${rootPath}\n - ${docsPath}`);
}

createDemoExcel().catch(err => {
  console.error(err);
  process.exit(1);
});
