# Kamar Outstandings to Kindo Converter

A simple internal tool to convert Kamar "Charged" CSV files into a format suitable for Kindo import.

## Usage

1.  Open `index.html` in a browser.
2.  Select your Kamar "Charged" CSV file(s).
3.  (Optional) Paste the current seed roll and click "Load seed roll" to filter for current students only.
4.  Enter the **School Name** and **MOE** number.
5.  Click **Process File**.
6.  Download the generated files (`outstandings.csv`, `payables.csv`, etc.).

## How It Works

The script performs several key steps to prepare the data for Kindo:

1.  **Cleans Data**: It removes records that are not needed, such as students with a zero balance, staff accounts, and students who have already left the school.
2.  **Filters Students (Optional)**: If a seed roll is provided, it filters the list to only include students currently enrolled.
3.  **Generates Kindo Files**: It creates three specific files required for Kindo import:
    *   `outstandings.csv`: The main file listing what each student owes.
    *   `payables.csv`: A list of all unique items being charged.
    *   `pcats.csv`: Links the items to their categories.
4.  **Creates Verification File**: It also generates a `removed_students.csv` file, which lists all the records that were filtered out and why, making it easy to verify the process.
