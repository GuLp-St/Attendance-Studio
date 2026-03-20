$job = Start-Job { Set-Location C:\Users\Administrator\Desktop\Attendance-Studio\attendance-studio; npm run dev }
Start-Sleep -Seconds 5
npm install puppeteer
node test_error.js
Stop-Job $job
Remove-Job $job
