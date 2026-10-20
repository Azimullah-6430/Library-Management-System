# Crescent Library Management System (CLMS)

B.S. Abdur Rahman Crescent Institute of Science and Technology, Chennai.

## Overview
A production-ready full-stack Library Management System with:
- **Authentication**: Pure JWT authentication with institutional email & password (with password visibility toggle).
- **Live Database**: Powered by MongoDB Atlas via Express.js REST API. No mock, fake, or localStorage fallbacks.
- **Dynamic Catalog**: Full book acquisition workflow with front & back cover uploads (Multer disk storage), accession numbers, categories, pricing, stock, shelf/row coordinates.
- **Reporting & Analytics**: Real-time aggregation metrics for inventory value, category breakdown, availability status, publication years, and shelf distribution.
- **Import / Export**: Streaming CSV export and bulk CSV import with format validation and live preview.
- **Appearance**: Responsive UI with Light/Dark mode themes and print styling.

## Running the Application
From the workspace root:
```bash
npm run dev
```
Open [http://localhost:5000](http://localhost:5000) in your browser.
