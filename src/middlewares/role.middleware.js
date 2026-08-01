const ApiResponse = require('../utils/apiResponse');

const requireRole = (requiredRole) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json(ApiResponse.error('UNAUTHORIZED', 'Authentication required'));
    }

    const allowedRoles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    if (!allowedRoles.includes(req.user.role) && req.user.role !== 'admin') {
      return res.status(403).json(ApiResponse.error('FORBIDDEN', 'Insufficient permissions'));
    }

    next();
  };
};

module.exports = requireRole;
