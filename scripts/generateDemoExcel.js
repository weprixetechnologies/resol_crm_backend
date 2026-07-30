const ExcelJS = require('exceljs');
const path = require('path');

async function createDemoExcel() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Users');

  // Define the headers based on the import service expectations
  worksheet.columns = [
    { header: 'Name', key: 'name', width: 20 },
    { header: 'Email', key: 'email', width: 25 },
    { header: 'Mobile', key: 'mobile', width: 15 },
    { header: 'City', key: 'city', width: 15 },
    { header: 'State', key: 'state', width: 15 },
    { header: 'Designation', key: 'designation', width: 20 },
    { header: 'Institute', key: 'institute', width: 25 },
    { header: 'Department', key: 'department', width: 15 },
    { header: 'Region', key: 'region', width: 15 },
    { header: 'Remark', key: 'remark', width: 30 }
  ];

  // Add some dummy rows
  worksheet.addRows([
    {
      name: 'Alice Cooper',
      email: 'alice@example.com',
      mobile: '9876543210',
      city: 'Mumbai',
      state: 'Maharashtra',
      designation: 'Professor',
      institute: 'Mumbai University',
      department: 'Computer Science',
      region: 'Indian',
      remark: 'Follow up next week'
    },
    {
      name: 'Bob Smith',
      email: 'bob@example.com',
      mobile: '8765432109',
      city: 'Delhi',
      state: 'Delhi',
      designation: 'HOD',
      institute: 'Delhi University',
      department: 'Physics',
      region: 'Indian',
      remark: 'Interested in bulk license'
    },
    {
      name: 'Charlie Davis',
      email: 'charlie@abroad.com',
      mobile: '+14155552671', // Valid, < 20 chars
      city: 'San Francisco',
      state: 'California',
      designation: 'Researcher',
      institute: 'Stanford',
      department: 'Biology',
      region: 'Abroad',
      remark: ''
    },
    {
      name: 'David Long',
      email: 'david@example.com',
      mobile: '999998888877777666665555', // Intentional error row (length > 20) to test the new validation!
      city: 'Bangalore',
      state: 'Karnataka',
      designation: 'Lecturer',
      institute: 'IISc',
      department: 'Math',
      region: 'Indian',
      remark: 'Test user'
    }
  ]);

  // Style the header row to look nice
  worksheet.getRow(1).font = { bold: true };

  const outputPath = path.join(__dirname, '../../demo_import_users.xlsx');
  await workbook.xlsx.writeFile(outputPath);
  console.log(`Demo Excel file created at: ${outputPath}`);
}

createDemoExcel().catch(console.error);
