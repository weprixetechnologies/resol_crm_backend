const ExcelJS = require('exceljs');
const db = require('../../config/db');
const { DuplicateUtil, normalizeEmail, normalizeMobile } = require('../users/duplicate.util');
const auditService = require('../audit/audit.service');

class ImportService {
  async previewImport(buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];

    const results = [];
    
    // Assume Row 1 is headers: Name, Email, Mobile, City, State, Designation, Institute, Department, Region, Remark
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // skip headers
      
      const [_, name, email, mobile, city, state, designation, institute, department, region, remark] = row.values;
      
      results.push({
        rowNumber,
        name: name?.toString() || '',
        email: email?.toString() || '',
        mobile: mobile?.toString() || '',
        city: city?.toString() || '',
        state: state?.toString() || '',
        designation: designation?.toString() || '',
        institute: institute?.toString() || '',
        department: department?.toString() || '',
        region_type: region?.toString().toLowerCase() === 'abroad' ? 'abroad' : 'indian',
        remark: remark?.toString() || ''
      });
    });

    // Check duplicates sequentially to ensure accuracy
    const preview = [];

    for (const row of results) {
      if (!row.email && !row.mobile) {
        preview.push({ ...row, status: 'INVALID', error: 'Email or Mobile required' });
        continue;
      }
      if (row.mobile && row.mobile.length > 20) {
        preview.push({ ...row, status: 'INVALID', error: 'Mobile number too long (max 20 chars)' });
        continue;
      }

      try {
        const dupCheck = await DuplicateUtil.checkDuplicate(row, true);
        if (dupCheck.isDuplicate) {
          preview.push({ ...row, status: 'EXACT_DUPLICATE', existingUserId: dupCheck.user.id });
        } else if (dupCheck.possibleMatch) {
          preview.push({ ...row, status: 'FUZZY_DUPLICATE', candidates: dupCheck.candidates });
        } else {
          preview.push({ ...row, status: 'VALID' });
        }
      } catch (err) {
        preview.push({ ...row, status: 'ERROR', error: err.message });
      }
    }

    return preview;
  }

  async commitImport(rows, adminId) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      let insertedCount = 0;
      
      for (const row of rows) {
        const emailNorm = normalizeEmail(row.email);
        const mobileNorm = normalizeMobile(row.mobile);

        const safeMobile = row.mobile ? row.mobile.substring(0, 20) : null;
        const safeMobileNorm = mobileNorm ? mobileNorm.substring(0, 20) : null;
        const safeEmail = row.email ? row.email.substring(0, 150) : null;
        const safeEmailNorm = emailNorm ? emailNorm.substring(0, 150) : null;

        let targetUserId = null;

        const [result] = await connection.query(
          `INSERT IGNORE INTO users (name, designation, department, institute, city, state, region_type, email, email_normalized, mobile, mobile_normalized, source, is_admin_verified, created_by, remarks)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', 1, ?, ?)`,
          [row.name, row.designation, row.department, row.institute, row.city, row.state, row.region_type, safeEmail, safeEmailNorm, safeMobile, safeMobileNorm, adminId, row.remark || null]
        );
        targetUserId = result.insertId;

        if (!targetUserId || targetUserId === 0) {
          const [existing] = await connection.query(
            `SELECT id FROM users WHERE (email_normalized = ? AND email_normalized IS NOT NULL) OR (mobile_normalized = ? AND mobile_normalized IS NOT NULL) LIMIT 1`,
            [safeEmailNorm, safeMobileNorm]
          );
          if (existing.length > 0) {
            targetUserId = existing[0].id;
          }
        }

        if (row.remark) {
          await connection.query(
            `INSERT INTO user_queries (user_id, remark, source, created_by) VALUES (?, ?, 'import', ?)`,
            [targetUserId, row.remark, adminId]
          );
        }

        insertedCount++;
      }

      await auditService.log({
        actorId: adminId,
        actorRole: 'admin',
        action: 'IMPORT_COMMIT',
        entityType: 'batch',
        meta: { count: insertedCount }
      });

      await connection.commit();
      return { success: true, count: insertedCount };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }
}

module.exports = new ImportService();
