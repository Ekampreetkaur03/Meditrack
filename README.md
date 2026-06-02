# MediTrack

Smart Hospital Queue Management System for clinics and hospitals.

## Features
- Hospital registration and staff/admin login
- Staff dashboard for adding patients
- Live queue and token tracking
- Patient portal using phone number
- WhatsApp notification integration
- Basic analytics and ambulance alert endpoint

## Folder Structure

```text
meditrack/
├── backend/
│   ├── server.js
│   ├── models.js
│   ├── middleware.js
│   ├── whatsapp.js
│   ├── routes/
│   ├── package.json
│   └── .env.example
└── frontend/
    ├── index.html
    ├── staff.html
    ├── patient.html
    ├── dashboard.html
    └── reports.html
```

## Setup

```bash
cd backend
npm install
```

Create `backend/.env` from `.env.example`:

```env
PORT=5000
JWT_SECRET=replace_with_a_long_random_secret
WHATSAPP_OWNER=91XXXXXXXXXX
MONGODB_URI=your_mongodb_atlas_uri
```

Start server:

```bash
npm start
```

Open:

```text
http://localhost:5000
```

## Important Security Notes
Do not share these publicly:
- `backend/.env`
- `backend/whatsapp_auth/`
- `backend/node_modules/`

## Clinic Testing Flow
1. Register hospital from Staff Login page.
2. Login using hospital admin or staff credentials.
3. Add patient from dashboard.
4. Patient opens portal and enters phone number.
5. Token status should be visible.
6. Test Call Next and WhatsApp alerts.
