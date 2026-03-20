// src/controllers/applicationController.js
// ─────────────────────────────────────────────────────────────
//  All business logic for student aid applications
// ─────────────────────────────────────────────────────────────

const db            = require('../models/database');
const { encrypt, ssnLastFour, maskSSN } = require('../utils/encryption');
const { generateConfirmationNumber, estimateAid, sanitizeApplication, paginate } = require('../utils/helpers');
const { sendEmail, confirmationTemplate, sarTemplate } = require('../utils/emailService');

// ─────────────────────────────────────────
//  POST /api/applications
//  Submit a new application
// ─────────────────────────────────────────
async function submitApplication(req, res) {
  try {
    const {
      // Step 1
      firstName, middleName, lastName, suffix, dateOfBirth, ssn,
      // Step 2
      addressLine1, addressLine2, city, state, zipCode, phoneNumber, email,
      // Step 3
      gender, citizenshipStatus, maritalStatus,
      // Step 4
      highSchoolName, graduationYear, collegeName, degreeLevel, enrollmentStatus,
      // Step 5
      annualIncome, dep1, dep2, dep3, dep4, dep5
    } = req.body;

    // Determine independence
    const isIndependent = [dep1, dep2, dep3, dep4, dep5].some(v => v === 'yes') ? 1 : 0;

    // Encrypt SSN — never store plain text
    const ssnEncrypted = encrypt(ssn.replace(/\D/g, '')); // strip dashes before encrypting
    const ssnLast4     = ssnLastFour(ssn);

    // Generate unique confirmation number
    const confirmationNumber = generateConfirmationNumber();

    // Estimate aid package
    const aidEstimate = estimateAid(parseFloat(annualIncome), isIndependent, enrollmentStatus);

    // Insert into database
    const stmt = db.prepare(`
      INSERT INTO applications (
        confirmation_number,
        first_name, middle_name, last_name, suffix,
        date_of_birth, ssn_encrypted, ssn_last_four,
        address_line1, address_line2, city, state, zip_code,
        phone_number, email,
        gender, citizenship_status, marital_status,
        high_school_name, graduation_year, college_name,
        degree_level, enrollment_status,
        is_independent, annual_income,
        dep_over_24, dep_married, dep_emancipated, dep_has_children, dep_veteran,
        estimated_aid, aid_type, aid_notes,
        status
      ) VALUES (
        ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        'submitted'
      )
    `);

    const result = stmt.run(
      confirmationNumber,
      firstName.trim(), middleName?.trim() || null, lastName.trim(), suffix || null,
      dateOfBirth, ssnEncrypted, ssnLast4,
      addressLine1.trim(), addressLine2?.trim() || null, city.trim(), state, zipCode,
      phoneNumber, email.toLowerCase(),
      gender || null, citizenshipStatus, maritalStatus,
      highSchoolName.trim(), String(graduationYear), collegeName.trim(),
      degreeLevel, enrollmentStatus,
      isIndependent, parseFloat(annualIncome),
      dep1 || null, dep2 || null, dep3 || null, dep4 || null, dep5 || null,
      aidEstimate.estimatedAid, aidEstimate.aidTypes, aidEstimate.note
    );

    const applicationId = result.lastInsertRowid;

    // Log status history
    db.prepare(`
      INSERT INTO status_history (application_id, old_status, new_status)
      VALUES (?, NULL, 'submitted')
    `).run(applicationId);

    // ── Send confirmation email ──────────────────────────
    // Fired immediately — student receives email within seconds
    const emailData = {
      firstName,
      lastName,
      confirmationNumber,
      estimatedAid: aidEstimate,
      submittedAt: new Date().toLocaleString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      })
    };

    // Send email — awaited so we know if it worked before responding
    const emailSent = await sendEmail(
      email.toLowerCase(),
      confirmationTemplate(emailData),
      applicationId
    );

    // Update confirmation_sent flag in DB
    if (emailSent) {
      db.prepare(`UPDATE applications SET confirmation_sent = 1 WHERE id = ?`).run(applicationId);
    }

    // Return success response
    return res.status(201).json({
      success:            true,
      message:            'Application submitted successfully.',
      confirmationNumber,
      applicationId,
      emailSent,    // frontend can show a notice if email failed
      estimatedAid: {
        total:       aidEstimate.estimatedAid,
        grantAmount: aidEstimate.grantAmount,
        loanAmount:  aidEstimate.loanAmount,
        types:       aidEstimate.aidTypes,
        note:        aidEstimate.note
      }
    });

  } catch (err) {
    console.error('submitApplication error:', err);
    return res.status(500).json({
      success: false,
      error:   'An error occurred while submitting your application. Please try again.'
    });
  }
}

// ─────────────────────────────────────────
//  GET /api/applications/status/:confirmationNumber
//  Check application status (public — no auth needed)
// ─────────────────────────────────────────
function checkStatus(req, res) {
  try {
    const { confirmationNumber } = req.params;
    const { email } = req.query; // require email to verify identity

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required to check status.' });
    }

    const app = db.prepare(`
      SELECT id, confirmation_number, first_name, last_name,
             ssn_last_four, status, submitted_at, reviewed_at,
             estimated_aid, aid_type, aid_notes, email
      FROM applications
      WHERE confirmation_number = ?
    `).get(confirmationNumber);

    if (!app || app.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(404).json({
        success: false,
        error:   'Application not found. Please check your confirmation number and email.'
      });
    }

    return res.json({
      success: true,
      application: {
        confirmationNumber: app.confirmation_number,
        applicantName:      `${app.first_name} ${app.last_name}`,
        ssnMasked:          maskSSN(app.ssn_last_four),
        status:             app.status,
        submittedAt:        app.submitted_at,
        reviewedAt:         app.reviewed_at || null,
        estimatedAid:       app.estimated_aid,
        aidType:            app.aid_type,
        aidNote:            app.aid_notes
      }
    });

  } catch (err) {
    console.error('checkStatus error:', err);
    return res.status(500).json({ success: false, error: 'Server error.' });
  }
}

// ─────────────────────────────────────────
//  GET /api/admin/applications
//  List all applications (admin only, paginated)
// ─────────────────────────────────────────
function listApplications(req, res) {
  try {
    const { page, limit, offset } = paginate(req.query.page, req.query.limit);
    const { status, search } = req.query;

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }

    if (search) {
      whereClause += ` AND (
        first_name LIKE ? OR last_name LIKE ? OR
        email LIKE ? OR confirmation_number LIKE ?
      )`;
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const total = db.prepare(`SELECT COUNT(*) as count FROM applications ${whereClause}`).get(...params);
    const apps  = db.prepare(`
      SELECT id, confirmation_number, first_name, last_name,
             email, ssn_last_four, status, submitted_at,
             city, state, estimated_aid, enrollment_status
      FROM applications
      ${whereClause}
      ORDER BY submitted_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return res.json({
      success: true,
      data: {
        applications: apps.map(a => ({
          ...a,
          ssnMasked: maskSSN(a.ssn_last_four)
        })),
        pagination: {
          page,
          limit,
          total:      total.count,
          totalPages: Math.ceil(total.count / limit)
        }
      }
    });

  } catch (err) {
    console.error('listApplications error:', err);
    return res.status(500).json({ success: false, error: 'Server error.' });
  }
}

// ─────────────────────────────────────────
//  GET /api/admin/applications/:id
//  Get single application detail (admin only)
// ─────────────────────────────────────────
function getApplication(req, res) {
  try {
    const app = db.prepare(`
      SELECT a.*,
             u.name as reviewer_name
      FROM applications a
      LEFT JOIN admin_users u ON u.id = a.reviewer_id
      WHERE a.id = ?
    `).get(req.params.id);

    if (!app) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }

    const history = db.prepare(`
      SELECT sh.*, u.name as changed_by_name
      FROM status_history sh
      LEFT JOIN admin_users u ON u.id = sh.changed_by
      WHERE sh.application_id = ?
      ORDER BY sh.changed_at DESC
    `).all(app.id);

    // Never send encrypted SSN — only last 4 digits
    const { ssn_encrypted, ...safeApp } = app;
    safeApp.ssnMasked = maskSSN(safeApp.ssn_last_four);

    return res.json({
      success:     true,
      application: safeApp,
      history
    });

  } catch (err) {
    console.error('getApplication error:', err);
    return res.status(500).json({ success: false, error: 'Server error.' });
  }
}

// ─────────────────────────────────────────
//  PATCH /api/admin/applications/:id/status
//  Update application status (admin only)
// ─────────────────────────────────────────
async function updateStatus(req, res) {
  try {
    const { id }     = req.params;
    const { status, notes } = req.body;

    const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(id);
    if (!app) {
      return res.status(404).json({ success: false, error: 'Application not found.' });
    }

    const oldStatus = app.status;

    // Update application
    db.prepare(`
      UPDATE applications
      SET status       = ?,
          reviewer_id  = ?,
          reviewer_notes = ?,
          reviewed_at  = datetime('now'),
          updated_at   = datetime('now')
      WHERE id = ?
    `).run(status, req.admin.id, notes || null, id);

    // Log the status change
    db.prepare(`
      INSERT INTO status_history (application_id, old_status, new_status, changed_by, note)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, oldStatus, status, req.admin.id, notes || null);

    // Send status update email
    const { sendEmail: send, statusUpdateTemplate } = require('../utils/emailService');
    send(app.email, statusUpdateTemplate({
      firstName:          app.first_name,
      lastName:           app.last_name,
      confirmationNumber: app.confirmation_number,
      newStatus:          status,
      note:               notes
    }), id).catch(() => {});

    // If approved, send SAR
    if (status === 'approved') {
      const sarData = {
        firstName:          app.first_name,
        lastName:           app.last_name,
        confirmationNumber: app.confirmation_number,
        estimatedAid:       app.estimated_aid,
        grantAmount:        app.estimated_aid * 0.6,  // approximate split
        loanAmount:         app.estimated_aid * 0.4,
        aidNote:            app.aid_notes
      };
      const { sarTemplate } = require('../utils/emailService');
      send(app.email, sarTemplate(sarData), id)
        .then(() => db.prepare(`UPDATE applications SET sar_sent=1 WHERE id=?`).run(id))
        .catch(() => {});
    }

    return res.json({
      success: true,
      message: `Application status updated to "${status}".`,
      applicationId: id,
      oldStatus,
      newStatus: status
    });

  } catch (err) {
    console.error('updateStatus error:', err);
    return res.status(500).json({ success: false, error: 'Server error.' });
  }
}

// ─────────────────────────────────────────
//  GET /api/admin/dashboard
//  Summary statistics for admin dashboard
// ─────────────────────────────────────────
function getDashboard(req, res) {
  try {
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'submitted'     THEN 1 ELSE 0 END) as submitted,
        SUM(CASE WHEN status = 'under_review'  THEN 1 ELSE 0 END) as under_review,
        SUM(CASE WHEN status = 'approved'      THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'rejected'      THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN status = 'pending_info'  THEN 1 ELSE 0 END) as pending_info,
        SUM(CASE WHEN status = 'approved' THEN estimated_aid ELSE 0 END) as total_aid_awarded,
        AVG(CASE WHEN status = 'approved' THEN estimated_aid END) as avg_aid_amount
      FROM applications
    `).get();

    const recentApps = db.prepare(`
      SELECT id, confirmation_number, first_name, last_name,
             email, status, submitted_at, state
      FROM applications
      ORDER BY submitted_at DESC
      LIMIT 5
    `).all();

    const byState = db.prepare(`
      SELECT state, COUNT(*) as count
      FROM applications
      GROUP BY state
      ORDER BY count DESC
      LIMIT 10
    `).all();

    return res.json({
      success: true,
      dashboard: {
        stats,
        recentApplications: recentApps,
        topStates: byState
      }
    });

  } catch (err) {
    console.error('getDashboard error:', err);
    return res.status(500).json({ success: false, error: 'Server error.' });
  }
}

module.exports = {
  submitApplication,
  checkStatus,
  listApplications,
  getApplication,
  updateStatus,
  getDashboard
};