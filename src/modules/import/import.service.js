const ExcelJS = require('exceljs');
const db = require('../../config/db');
const { normalizeEmail, normalizeMobile } = require('../users/duplicate.util');
const auditService = require('../audit/audit.service');

class ImportService {
  async previewImport(buffer) {
    const startTime = Date.now();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = workbook.worksheets[0];

    const parsedRows = [];
    
    // Dynamic Header Detection
    let headerMap = {};
    const firstRow = worksheet.getRow(1);
    if (firstRow && firstRow.values) {
      firstRow.values.forEach((val, colIdx) => {
        if (!val) return;
        const normalized = val.toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '');
        if (['name', 'fullname'].includes(normalized)) headerMap.name = colIdx;
        else if (['email', 'emailaddress'].includes(normalized)) headerMap.email = colIdx;
        else if (['mobile', 'phone', 'mobilenumber', 'phonenumber'].includes(normalized)) headerMap.mobile = colIdx;
        else if (['isd', 'isdcode', 'countrycode', 'code'].includes(normalized)) headerMap.country_code = colIdx;
        else if (['city'].includes(normalized)) headerMap.city = colIdx;
        else if (['state'].includes(normalized)) headerMap.state = colIdx;
        else if (['designation', 'role', 'title'].includes(normalized)) headerMap.designation = colIdx;
        else if (['institute', 'company', 'organization'].includes(normalized)) headerMap.institute = colIdx;
        else if (['department', 'dept'].includes(normalized)) headerMap.department = colIdx;
        else if (['region', 'regiontype', 'country'].includes(normalized)) headerMap.region_type = colIdx;
        else if (['status', 'customerstatus', 'userstatus'].includes(normalized)) headerMap.status = colIdx;
        else if (['tag1', 'tag 1', 'tag_1'].includes(normalized)) headerMap.tag1 = colIdx;
        else if (['tag2', 'tag 2', 'tag_2'].includes(normalized)) headerMap.tag2 = colIdx;
        else if (['remark', 'remarks', 'notes', 'comment'].includes(normalized)) headerMap.remark = colIdx;
      });
    }

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // skip headers
      
      const vals = row.values;
      let name, email, mobile, country_code, city, state, designation, institute, department, region, statusVal, tag1Val, tag2Val, remark;

      if (Object.keys(headerMap).length > 0) {
        name = headerMap.name ? vals[headerMap.name] : null;
        email = headerMap.email ? vals[headerMap.email] : null;
        mobile = headerMap.mobile ? vals[headerMap.mobile] : null;
        country_code = headerMap.country_code ? vals[headerMap.country_code] : null;
        city = headerMap.city ? vals[headerMap.city] : null;
        state = headerMap.state ? vals[headerMap.state] : null;
        designation = headerMap.designation ? vals[headerMap.designation] : null;
        institute = headerMap.institute ? vals[headerMap.institute] : null;
        department = headerMap.department ? vals[headerMap.department] : null;
        region = headerMap.region_type ? vals[headerMap.region_type] : null;
        statusVal = headerMap.status ? vals[headerMap.status] : null;
        tag1Val = headerMap.tag1 ? vals[headerMap.tag1] : null;
        tag2Val = headerMap.tag2 ? vals[headerMap.tag2] : null;
        remark = headerMap.remark ? vals[headerMap.remark] : null;
      } else {
        if (vals.length >= 14) {
          [_, name, email, mobile, country_code, city, state, designation, institute, department, region, statusVal, tag1Val, tag2Val, remark] = vals;
        } else if (vals.length >= 11) {
          [_, name, email, mobile, country_code, city, state, designation, institute, department, region, remark] = vals;
        } else {
          [_, name, email, mobile, city, state, designation, institute, department, region, remark] = vals;
        }
      }

      let parsedCode = country_code?.toString().trim() || '';
      if (parsedCode && !parsedCode.startsWith('+') && !isNaN(parsedCode)) {
        parsedCode = '+' + parsedCode;
      }

      const parsedStatus = (statusVal && statusVal.toString().trim().toLowerCase() === 'unverified') ? 'unverified' : 'active';

      parsedRows.push({
        rowNumber,
        name: name?.toString().trim() || '',
        email: email?.toString().trim() || '',
        mobile: mobile?.toString().trim() || '',
        country_code: parsedCode,
        city: city?.toString().trim() || '',
        state: state?.toString().trim() || '',
        designation: designation?.toString().trim() || '',
        institute: institute?.toString().trim() || '',
        department: department?.toString().trim() || '',
        region_type: region?.toString().toLowerCase() === 'abroad' ? 'abroad' : 'indian',
        user_status: parsedStatus,
        tag1: tag1Val?.toString().trim() || '',
        tag2: tag2Val?.toString().trim() || '',
        remark: remark?.toString().trim() || ''
      });
    });

    // Bulk DB Hash Pre-fetch for O(1) duplicate checking
    const [existingUsers] = await db.query('SELECT email_normalized, mobile_normalized FROM users');
    const existingEmails = new Set();
    const existingMobiles = new Set();

    for (const u of existingUsers) {
      if (u.email_normalized) existingEmails.add(u.email_normalized);
      if (u.mobile_normalized) existingMobiles.add(u.mobile_normalized);
    }

    const preview = [];
    const fileSeenEmails = new Set();
    const fileSeenMobiles = new Set();

    let validCount = 0;
    let exactDuplicateCount = 0;
    let invalidCount = 0;

    for (const row of parsedRows) {
      if (!row.name && !row.email && !row.mobile) {
        continue; // Skip empty trailing rows
      }

      if (!row.email && !row.mobile) {
        preview.push({ ...row, status: 'INVALID', error: 'Email or Mobile required' });
        invalidCount++;
        continue;
      }

      if (row.mobile && row.mobile.length > 20) {
        preview.push({ ...row, status: 'INVALID', error: 'Mobile number too long (max 20 chars)' });
        invalidCount++;
        continue;
      }

      const emailNorm = normalizeEmail(row.email);
      const mobileNorm = normalizeMobile(row.mobile);

      // Check DB duplication or File internal duplication
      const isDbDuplicate = (emailNorm && existingEmails.has(emailNorm)) || (mobileNorm && existingMobiles.has(mobileNorm));
      const isFileDuplicate = (emailNorm && fileSeenEmails.has(emailNorm)) || (mobileNorm && fileSeenMobiles.has(mobileNorm));

      if (emailNorm) fileSeenEmails.add(emailNorm);
      if (mobileNorm) fileSeenMobiles.add(mobileNorm);

      if (isDbDuplicate || isFileDuplicate) {
        preview.push({ ...row, status: 'EXACT_DUPLICATE' });
        exactDuplicateCount++;
      } else {
        preview.push({ ...row, status: 'VALID' });
        validCount++;
      }
    }

    const executionTimeMs = Date.now() - startTime;

    return {
      summary: {
        totalRows: preview.length,
        validCount,
        exactDuplicateCount,
        invalidCount,
        executionTimeMs
      },
      rows: preview
    };
  }

  async commitImport(rows, userId, userRole = 'staff') {
    const startTime = Date.now();
    if (!Array.isArray(rows) || rows.length === 0) {
      return { success: true, count: 0, timeMs: 0 };
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const CHUNK_SIZE = 2500;
      let insertedCount = 0;
      let skippedCount = 0;

      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        
        const valuePlaceholders = [];
        const queryParams = [];

        for (const row of chunk) {
          const emailNorm = normalizeEmail(row.email);
          const mobileNorm = normalizeMobile(row.mobile);

          const safeMobile = row.mobile ? row.mobile.substring(0, 20) : null;
          const safeMobileNorm = mobileNorm ? mobileNorm.substring(0, 20) : null;
          const safeEmail = row.email ? row.email.substring(0, 150) : null;
          const safeEmailNorm = emailNorm ? emailNorm.substring(0, 150) : null;
          const safeCountryCode = row.country_code ? row.country_code.substring(0, 10) : null;
          const userStatus = (row.user_status === 'unverified' || row.status_value === 'unverified') ? 'unverified' : 'active';
          const tag1Val = row.tag1 || null;
          const tag2Val = row.tag2 || null;
          const safeName = row.name ? row.name.substring(0, 150) : 'Unknown';

          valuePlaceholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'import\', 1, ?, ?)');
          queryParams.push(
            safeName,
            row.designation || null,
            row.department || null,
            row.institute || null,
            row.city || null,
            row.state || null,
            row.region_type === 'abroad' ? 'abroad' : 'indian',
            safeCountryCode,
            safeEmail,
            safeEmailNorm,
            safeMobile,
            safeMobileNorm,
            userStatus,
            tag1Val,
            tag2Val,
            userId,
            row.remark || null
          );
        }

        const bulkQuery = `
          INSERT IGNORE INTO users 
          (name, designation, department, institute, city, state, region_type, country_code, email, email_normalized, mobile, mobile_normalized, status, tag1, tag2, source, is_admin_verified, created_by, remarks)
          VALUES ${valuePlaceholders.join(', ')}
        `;

        const [result] = await connection.query(bulkQuery, queryParams);
        insertedCount += result.affectedRows;
        skippedCount += (chunk.length - result.affectedRows);
      }

      // Handle user remarks for rows that specified remarks
      const remarkRows = rows.filter(r => r.remark && r.remark.trim() !== '');
      if (remarkRows.length > 0) {
        for (let i = 0; i < remarkRows.length; i += CHUNK_SIZE) {
          const remarkChunk = remarkRows.slice(i, i + CHUNK_SIZE);
          for (const row of remarkChunk) {
            const emailNorm = normalizeEmail(row.email);
            const mobileNorm = normalizeMobile(row.mobile);
            if (emailNorm || mobileNorm) {
              await connection.query(
                `INSERT INTO user_queries (user_id, remark, source, created_by)
                 SELECT id, ?, 'import', ? FROM users 
                 WHERE (email_normalized = ? AND email_normalized IS NOT NULL) 
                    OR (mobile_normalized = ? AND mobile_normalized IS NOT NULL) 
                 LIMIT 1`,
                [row.remark.trim(), userId, emailNorm, mobileNorm]
              );
            }
          }
        }
      }

      // Record batch details into import_batches
      await connection.query(
        `INSERT INTO import_batches (filename, total_rows, success_count, duplicate_count, error_count, status, uploaded_by)
         VALUES ('bulk_import.xlsx', ?, ?, ?, 0, 'committed', ?)`,
        [rows.length, insertedCount, skippedCount, userId]
      );

      await auditService.log({
        actorId: userId,
        actorRole: userRole || 'staff',
        action: 'IMPORT_COMMIT',
        entityType: 'batch',
        meta: { totalRows: rows.length, insertedCount, skippedCount }
      });

      await connection.commit();
      const executionTimeMs = Date.now() - startTime;
      return { success: true, count: insertedCount, skippedCount, totalProcessed: rows.length, timeMs: executionTimeMs };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }
}

module.exports = new ImportService();
