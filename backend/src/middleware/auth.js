'use strict';
const passport = require('../config/passport');

/**
 * Protect middleware: validates JWT Bearer token using Passport JWT Strategy
 */
exports.protect = (req, res, next) => {
  passport.authenticate('jwt', { session: false }, (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      const message = info ? info.message : 'Not authorized, valid token is required.';
      return res.status(401).json({ success: false, message });
    }
    req.user = user;
    next();
  })(req, res, next);
};

/**
 * Authorize middleware: restricts access based on roles
 */
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Role "${req.user ? req.user.role : 'guest'}" is not authorized to perform this action.`,
      });
    }
    next();
  };
};
