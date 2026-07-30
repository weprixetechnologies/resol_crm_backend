const ApiResponse = require('../utils/apiResponse');

const requireRole = (requiredRole) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json(ApiResponse.error('UNAUTHORIZED', 'Authentication required'));
    }

    if (req.user.role !== requiredRole && req.user.role !== 'admin') {
      // If the required role is 'staff' but the user is 'admin', we usually allow admins to do staff actions.
      // If we need strict checking, we can adjust. Based on 06-RBAC-PERMISSIONS, admin has full system control.
      return res.status(403).json(ApiResponse.error('FORBIDDEN', 'Insufficient permissions'));
    }

    next();
  };
};

module.exports = requireRole;
