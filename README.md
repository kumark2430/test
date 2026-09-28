# RTS Employee Manager — Google Sheets + Vercel

This project stores employee records in the supplied Google spreadsheet instead of browser `localStorage`.

## Data structure

The setup creates two new tabs in the target spreadsheet:

- `Employees`: ID, name, designation, zone, category, phone, join date, status, relieving date, notes, created timestamp, and updated timestamp.
- `Zones`: the available zone names.

Existing spreadsheet tabs are not overwritten.

## Importing employees

Use **Import CSV/Excel** in the dashboard and select a `.csv`, `.xlsx`, or `.xls` file. The first worksheet is imported. The file must contain a `Name` column.

Supported columns are `ID`, `Name`, `Designation`, `Zone`, `Category`, `Phone`, `Join Date`, `Status`, `Relieving Date`, and `Notes`. Common alternatives such as `Employee Name`, `Role`, `Mobile Number`, `Joining Date`, and `Remarks` are recognized automatically.

- Rows without a name are skipped.
- Employees with an existing matching ID are updated. Rows without an ID are added as new employees.
- New zone names are added automatically to the `Zones` tab.
- Imports run in batches of 200 employees.
- Dates can be Excel date cells, `YYYY-MM-DD`, or `DD/MM/YYYY`.

After replacing `Code.gs`, create a new Apps Script deployment version before testing the import.

## 1. Connect the Google Sheet

1. Open the editable version of your Google Sheet. The `/pubhtml` link is only a public, read-only view.
2. Select **Extensions → Apps Script**.
3. Replace the editor content with `Code.gs` from this project.
4. In `configureRTS`, keep or change the username and replace `CHANGE_THIS_TO_A_STRONG_PASSWORD` with a strong password.
5. Select `configureRTS` in the function list and click **Run**. Approve Google's permission prompt. This creates the `Employees` and `Zones` tabs and stores the login securely in Script Properties.
6. Select **Deploy → New deployment → Web app**.
7. Set **Execute as** to **Me** and **Who has access** to **Anyone**. Deploy it.
8. Copy the Web app URL ending in `/exec`.
9. Open that URL directly in a private/incognito browser window. It should display JSON containing `"ok":true`. If Google asks you to sign in, edit the deployment and change access to **Anyone**.

Do not put the Apps Script URL or Sheet login password in `index.html` or `config.js`.

## 2. Test locally

The Google Sheet connection runs through Vercel's `/api/sheets` function. For a full local test, install the Vercel CLI and add the environment variable described below, then run:

```bash
vercel dev
```

Then open the local URL shown by Vercel, sign in, add one test employee, and confirm that it appears in the `Employees` tab.

## 3. Publish to Vercel

### Vercel dashboard

1. Put all project files in a GitHub repository.
2. In Vercel, choose **Add New → Project** and import the repository.
3. Keep **Framework Preset** as **Other**, leave the build command and output directory empty.
4. Open **Settings → Environment Variables** and add:
   - Name: `GOOGLE_APPS_SCRIPT_URL`
   - Value: the Apps Script Web app URL ending in `/exec`
   - Environments: Production, Preview, and Development
5. Deploy. If the project was already deployed, select **Deployments → Redeploy** after adding the environment variable.

### Vercel CLI

```bash
npm install -g vercel
vercel
vercel env add GOOGLE_APPS_SCRIPT_URL
vercel --prod
```

The browser now calls the same Vercel domain at `/api/sheets`; Vercel calls Google Apps Script on the server. This avoids browser CORS failures and keeps the Apps Script URL out of the public website. Admin credentials remain in the private Apps Script project.

## If the login shows “Failed to fetch”

1. Confirm `GOOGLE_APPS_SCRIPT_URL` exists in Vercel and contains the complete `/exec` URL, not the `/dev` test URL.
2. Redeploy after adding or changing the environment variable.
3. Confirm the Apps Script deployment access is **Anyone**.
4. Confirm the deployed project includes `api/sheets.js`.

## Updating the site

After changing files, push the changes to the connected GitHub repository. Vercel will deploy the update automatically.
