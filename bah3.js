const fs = require('fs');

// --- 1. Main Execution Logic ---
function solveCodeBashChallenge(inputFile, outputFile) {
    if (process.argv.length < 4) {
        console.error("Usage: node bash2.js <input_file> <output_file>");
        return;
    }

    try {
        const inputContent = fs.readFileSync(inputFile, 'utf8');
        const { organization, days, employees } = parseInput(inputContent);

        console.log(`Successfully parsed input for ${days.length} days and ${employees.length} employees.`);
        console.log(`Fixed Daily Cost (F): ${organization.fixedDailyCost}`);

        // --- CORE ALGORITHM GOES HERE ---
        // This is the placeholder for your optimization algorithm. 
        const schedule = generateSimpleSchedule(days, employees, organization); 
        // ---------------------------------

        const outputContent = formatOutput(schedule, days); 
        fs.writeFileSync(outputFile, outputContent);
        console.log(`Schedule written to ${outputFile}`);

        // OPTIONAL: Calculate and display the score of the generated schedule
        const totalScore = calculateTotalScore(schedule, organization, days, employees);
        console.log(`Calculated Total Score (Simplified, ignoring overtime/training): ${totalScore.toFixed(2)}`);

    } catch (error) {
        console.error("An error occurred:", error.message);
    }
}

// -----------------------------------------------------------------------------
// --- 2. Input Parsing (Robust) ---
function parseInput(content) {
    // Filter out comments and blank lines
    const lines = content.trim().split('\n').filter(line => !line.startsWith('#') && line.trim() !== '');
    let lineIndex = 0;

    // Organization (Line 1)
    if (lineIndex >= lines.length) throw new Error("Missing Organization line.");
    const orgParts = lines[lineIndex++].split(/\s+/).map(Number);
    const organization = {
        overtimeModifier: orgParts[0], 
        fixedDailyCost: orgParts[1]     
    };

    // Number of Days (Line 2)
    if (lineIndex >= lines.length) throw new Error("Missing Number of Days line.");
    const numberOfDays = Number(lines[lineIndex++]);

    // Days Data
    const days = [];
    // Calculate the line index where the employee data should begin
    const employeeStartLine = lineIndex + numberOfDays;

    for (let i = 0; i < numberOfDays; i++) {
        if (lineIndex >= lines.length) throw new Error(`Input ended unexpectedly while reading days (Expected ${numberOfDays}).`);
        
        const line = lines[lineIndex++];
        const parts = line.split(/\s+/);
        const dayId = Number(parts[0]);

        if (parts.length === 1) {
            // Closed Day: day_id only
            days.push({ dayId, type: 'closed', start: 0, end: 0, dailyRevenue: 0, requiredSkills: [] });
        } else if (parts.length >= 5) {
            // Open Day: day_id start end daily_revenue required_skills_csv
            days.push({
                dayId,
                type: 'open',
                start: Number(parts[1]),
                end: Number(parts[2]),
                dailyRevenue: Number(parts[3]),
                requiredSkills: parts[4].split(',').filter(s => s)
            });
        } else {
            console.warn(`Skipping malformed day line (ID ${dayId}): ${line}`);
            days.push({ dayId, type: 'closed', start: 0, end: 0, dailyRevenue: 0, requiredSkills: [] }); 
        }
    }
    
    // Safety check: skip lines until we reach the estimated employee start line
    while(lineIndex < employeeStartLine && lineIndex < lines.length) {
        lineIndex++;
    }

    // Employees Data (Remaining lines)
    const employees = [];
    for (; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        if (!line || line.trim() === '') continue; 

        // {id} {max_hours_per_week} {salary_per_hour} {learning_rate} {teaching_rate} {skills_csv_or_underscore} {vacation_days_csv_or_underscore}
        const parts = line.split(/\s+/);
        if (parts.length < 7) {
            console.warn(`Skipping malformed employee line (less than 7 parts): ${line}`);
            continue; 
        }

        const vacationDaysCSV = parts[6] === '_' ? '' : parts[6];
        const skillsCSV = parts[5] === '_' ? '' : parts[5];
        
        employees.push({
            id: Number(parts[0]),
            maxHoursPerWeek: Number(parts[1]),
            salaryPerHour: Number(parts[2]),
            learningRate: Number(parts[3]),
            teachingRate: Number(parts[4]),
            skills: new Set(skillsCSV.split(',').filter(s => s)), 
            vacationDays: new Set(vacationDaysCSV.split(',').filter(d => d).map(Number)),
            // State tracking (initialization)
            trainingPoints: {}, 
            hoursWorked: Array(numberOfDays).fill(0) 
        });
    }

    return { organization, days, employees };
}

// ----------------------------------------------------------------------------
// --- 3. Simple Schedule Generation (Placeholder for Optimization) ---
function generateSimpleSchedule(days, employees, organization) {
    const schedule = {}; 
    
    for (const day of days) {
        schedule[day.dayId] = [];

        if (day.type === 'closed') {
            continue;
        }

        const openHours = day.end - day.start;
        if (openHours <= 0) continue;

        // Eenvoudige Heuristiek: Voor elk uur en vereiste vaardigheid, zoek ÉÉN getrainde werknemer
        for (let hour = day.start; hour < day.end; hour++) {
            for (const requiredSkill of day.requiredSkills) {
                
                let foundWorker = false;
                for (const employee of employees) {
                    // Controleer vakantiedag
                    if (employee.vacationDays.has(day.dayId)) continue; 

                    // Vereenvoudiging: Controleer of de werknemer initieel is opgeleid
                    if (employee.skills.has(requiredSkill)) { 
                        
                        // Controleer op overlappende shiften voor dezelfde werknemer
                        const isScheduledThisHour = schedule[day.dayId].some(shift => 
                            shift.employeeId === employee.id && hour >= shift.start && hour < shift.end
                        );
                        if (isScheduledThisHour) continue;

                        // Creëer een shift token voor dit uur
                        schedule[day.dayId].push({
                            employeeId: employee.id,
                            start: hour,
                            end: hour + 1, // 1-uur shift
                            skill: requiredSkill
                        });
                        foundWorker = true;
                        // Stop na het vinden van één werknemer voor volledige dekking
                        break; 
                    }
                }
            }
        }

        // Voeg opeenvolgende 1-uur shifts samen voor dezelfde werknemer/vaardigheid
        const mergedShifts = mergeShifts(schedule[day.dayId]);
        schedule[day.dayId] = mergedShifts;
    }

    return schedule;
}

function mergeShifts(shifts) {
    // Voegt opeenvolgende één-uur shifts samen tot enkele tokens.
    const map = new Map(); 
    shifts.forEach(s => {
        const key = `${s.employeeId}-${s.skill}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(s.start);
    });

    const merged = [];
    map.forEach((starts, key) => {
        const [employeeId, skill] = key.split('-');
        starts.sort((a, b) => a - b);
        
        let currentStart = starts[0];
        let currentEnd = starts[0] + 1;

        for (let i = 1; i < starts.length; i++) {
            if (starts[i] === currentEnd) {
                currentEnd = starts[i] + 1;
            } else {
                merged.push({ employeeId: Number(employeeId), start: currentStart, end: currentEnd, skill });
                currentStart = starts[i];
                currentEnd = starts[i] + 1;
            }
        }
        merged.push({ employeeId: Number(employeeId), start: currentStart, end: currentEnd, skill });
    });
    return merged;
}

// ----------------------------------------------------------------------------
// --- 4. Output Formatting ---
function formatOutput(schedule, days) {
    let output = "";
    // Use the original ordered list of days to ensure correct output sequence
    const dayMap = days.reduce((map, day) => (map[day.dayId] = day, map), {});
    const sortedDayIds = days.map(day => day.dayId); 

    for (const dayId of sortedDayIds) {
        const dayData = dayMap[dayId];
        const shifts = schedule[dayId];
        let line = `${dayId}`;

        if (dayData.type === 'closed') {
            // Closed day must be 'day_id _'
            line += ' _'; 
        } else if (!shifts || shifts.length === 0) {
            // Open day with no shifts is just 'day_id'
            // line remains just `${dayId}`
        } else {
            const shiftTokens = shifts.map(s => 
                `${s.employeeId}-${s.start}-${s.end}-${s.skill}`
            );
            line += ' ' + shiftTokens.join(' ');
        }
        output += line + '\n';
    }
    
    return output.trim();
}

// ----------------------------------------------------------------------------
// --- 5. Simplified Score Calculation (For verification) ---
function calculateTotalScore(schedule, organization, days, employees) {
    let totalScore = 0;
    
    // WARNING: This is a simplified score calculation.
    
    const employeeMap = employees.reduce((map, emp) => (map[emp.id] = emp, map), {});
    const dayMap = days.reduce((map, day) => (map[day.dayId] = day, map), {});
    
    const F = organization.fixedDailyCost;

    // Simplified Payroll (P_d)
    const calculatePayrollDay = (dayId) => {
        let payrollDay = 0;
        const shifts = schedule[dayId] || [];
        for (const shift of shifts) {
            const employee = employeeMap[shift.employeeId];
            const hours = shift.end - shift.start;
            // Simplification: Assumes all are BASE hours
            payrollDay += hours * employee.salaryPerHour; 
        }
        return payrollDay;
    }

    // Capacity Calculation (C_d)
    const calculateCapacityDay = (dayData, shifts) => {
        if (dayData.type === 'closed') return 0;
        
        const operatingHours = dayData.end - dayData.start;
        const requiredSkills = dayData.requiredSkills;
        const totalRequiredSkillHours = operatingHours * requiredSkills.length;
        if (totalRequiredSkillHours === 0) return 0;

        let totalHourlySkillCoverage = 0;
        
        for (let hour = dayData.start; hour < dayData.end; hour++) {
            for (const skill of requiredSkills) {
                let hourlyCoverage = 0;
                
                const employeesWorking = shifts.filter(s => 
                    s.skill === skill && hour >= s.start && hour < s.end
                );

                for (const shift of employeesWorking) {
                    const employee = employeeMap[shift.employeeId];
                    // Simplification: assume initial skills are fixed
                    if (employee.skills.has(skill)) { 
                        hourlyCoverage += 1; // Trained = Full coverage
                    } else {
                        hourlyCoverage += 0.5; // Untrained = Half coverage
                    }
                }
                
                totalHourlySkillCoverage += Math.min(hourlyCoverage, 1.0); // Coverage maxes at 1.0
            }
        }
        
        return totalHourlySkillCoverage / totalRequiredSkillHours; // C_d (0..1)
    }

    // --- Daily Profit Summation ---
    for (const day of days) {
        const dayData = dayMap[day.dayId];
        const R_d = dayData.dailyRevenue;
        const P_d = calculatePayrollDay(day.dayId);
        
        let profit_d = 0;
        if (dayData.type === 'closed') {
            // Closed day: profit_d = -F
            profit_d = -F;
        } else {
            const C_d = calculateCapacityDay(dayData, schedule[day.dayId] || []);
            // Open day: profit_d = R_d * (C_d)^2 - P_d - F
            profit_d = R_d * Math.pow(C_d, 2) - P_d - F;
        }
        
        totalScore += profit_d;
    }

    return totalScore;
}


// Check if the script is being run directly
if (require.main === module) {
    solveCodeBashChallenge(process.argv[2], process.argv[3]);
}