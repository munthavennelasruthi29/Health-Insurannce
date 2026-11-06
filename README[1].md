# Pre-Auth Claim Tracker (Frontend + Backend)

A hospital claim assessment tool. The **frontend** (HTML/CSS/JS) shows the form, table and report.
The **backend** (Node.js + Express) saves claims, stores receipts and does the calculation.

## Folder structure

```
preauth-claim-tracker/
├── package.json        <- list of packages the project needs
├── server.js           <- BACKEND: web server and API routes
├── calculator.js       <- BACKEND: room rent capping, ICU limit, policy-year split...
├── db.js               <- BACKEND: saves/loads claims in data/claims.json
├── data/claims.json    <- your saved claims (created automatically)
├── uploads/            <- uploaded receipts (created automatically)
└── public/             <- FRONTEND
    ├── index.html
    ├── style.css
    └── script.js
```

## How to run (step by step)

1. **Install Node.js** (version 18 or newer) from https://nodejs.org if you do not have it.
   Check with: `node -v`
2. **Unzip** this folder and open it in VS Code (File > Open Folder).
3. Open the VS Code terminal (Terminal > New Terminal).
4. Install the packages (only needed once):
   ```
   npm install
   ```
5. Start the server:
   ```
   npm start
   ```
6. Open your browser at **http://localhost:3000**
7. To stop the server, click in the terminal and press `Ctrl + C`.

> Important: open the page through `http://localhost:3000`. Do NOT double-click `index.html`
> or use Live Server, because then the frontend cannot reach the backend.

## API (what the frontend asks the backend)

| Method | URL | What it does |
|--------|-----|--------------|
| GET    | /api/claims            | List all claims with calculated results |
| GET    | /api/claims/:id        | One claim + previous-year history |
| POST   | /api/claims            | Save a new claim (form + optional receipt) |
| PATCH  | /api/claims/:id/status | Set Pending / Approved / Rejected |
| DELETE | /api/claims/:id        | Delete a claim and its receipt file |

## Things you can change

- **Category limits** (max payable per disease type): top of `calculator.js`.
- **Port**: run `PORT=4000 npm start` (Mac/Linux) or edit `PORT` in `server.js`.
- **Max receipt size**: `MAX_FILE_BYTES` in `server.js` (now 5 MB).

## Notes

- Claims are stored in a plain JSON file, which is fine for learning and small use.
  For many users, move to a real database (SQLite, PostgreSQL or MongoDB) by replacing `db.js`.
- There is no login yet. Add authentication before using real patient data.
- Back up the `data/` and `uploads/` folders to keep your records safe.
