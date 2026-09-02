TaxiFlow JWT update
===================

1. Install the JWT dependency from your project folder:
   npm install jsonwebtoken

2. Generate a strong secret (run once):
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

3. Add the generated value to backend/.env:
   JWT_SECRET=your_generated_value
   JWT_EXPIRES_IN=8h

4. Replace the matching files in your TaxiFlow project with the files in this package.

5. Restart the Node server and sign in again. Old fake sessions will not work.

Additional dashboards included in this version:
- frontend/superadmin.html
- frontend/bus-rank-admin.html
- frontend/driver.html
- frontend/user.html

Additional backend routes included:
- backend/routes/rankRoutes.js
- backend/routes/registerRoutes.js (kept public)
- backend/routes/driverRoutes.js

Read backend/routes/ADMIN_AND_COMMUTER_PATCH.txt for the two route files that
were pasted in chat instead of uploaded as standalone files.

Important:
- Never upload or commit backend/.env.
- Do not use the example JWT secret in production.
- The frontend now sends Authorization: Bearer <token> automatically.
