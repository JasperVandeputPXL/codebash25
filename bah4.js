const fs = require('fs');

/**
 * Parses the raw input file content into structured data (days and employees).
 * @param {string} content - The content of the input file (H_Mentoring.txt).
 * @returns {{days: Object, employees: Object, global: {fixedDailyCost: number}}}
 */
function parseInput(content) {
    const lines = content.trim().split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    // 1. Global Parameters (first line)
    const globalParams = lines.shift().split(/\s+/).map(Number);
    const fixedDailyCost = globalParams[0] || 200;
    
    // 2. Planning Horizon (second line - ignored for dynamic parsing)
    lines.shift(); 
    
    const dayRequirements = {};
    const employeeData = {};
    
    let isParsingDays = true;

    // 3. Parse Day and Employee Lines
    for (const line of lines) {
        const parts = line.split(/\s+/);
        const firstPart = parseInt(parts[0], 10);
        
        if (isParsingDays) {
            // Closed Day: day_id
            if (parts.length === 1 && !isNaN(firstPart)) {
                dayRequirements[firstPart] = { day_id: firstPart, open: false, fixedCost: fixedDailyCost };
            }
            // Open Day: day_id start end daily_revenue required_skills_csv
            else if (parts.length >= 5 && !isNaN(firstPart) && firstPart in dayRequirements === false) {
                const [day_id, start, end, daily_revenue, required_skills_csv] = parts;
                
                const dayIdNum = parseInt(day_id, 10);
                const startHour = parseInt(start, 10);
                const endHour = parseInt(end, 10);
                
                const skillCounts = {};
                const requiredSkills = required_skills_csv.split(',').filter(s => s && s !== '_');
                
                for (const skill of requiredSkills) {
                    skillCounts[skill] = (skillCounts[skill] || 0) + 1;
                }
                
                // Map required skills to slots per hour: { 'hour-skill': count }
                const requiredSlots = {};
                let totalRequiredHours = 0;
                
                for (let hour = startHour; hour < endHour; hour++) {
                    for (const skill in skillCounts) {
                        requiredSlots[`${hour}-${skill}`] = skillCounts[skill];
                        totalRequiredHours += skillCounts[skill];
                    }
                }
                
                dayRequirements[dayIdNum] = {
                    day_id: dayIdNum, open: true, start: startHour, end: endHour, 
                    revenue: parseFloat(daily_revenue), fixedCost: fixedDailyCost,
                    totalRequiredHours: totalRequiredHours, requiredSlots: requiredSlots
                };
            } else if (parts.length === 7) {
                // The first 7-part line after days is the start of employee data
                isParsingDays = false;
                // Intentional fall-through to process the first employee line
            }
        }
        
        if (!isParsingDays) {
            // Employee line: id max_hours_per_week salary_per_hour learning_rate teaching_rate skills_csv_or_underscore vacation_days_csv_or_underscore
            if (parts.length === 7) {
                const [id, max_hours, salary, learning, teaching, skills_csv, vacation_csv] = parts;
                const employeeId = parseInt(id, 10);
                
                employeeData[employeeId] = {
                    id: employeeId,
                    maxHoursPerWeek: parseInt(max_hours, 10),
                    salaryPerHour: parseFloat(salary),
                    learningRate: parseFloat(learning),
                    teachingRate: parseFloat(teaching),
                    skills: new Set(skills_csv === '_' ? [] : skills_csv.split(',')),
                    vacationDays: new Set(vacation_csv === '_' ? [] : vacation_csv.split(',').map(Number)),
                    hoursWorked: 0,
                };
            }
        }
    }
    
    // --- Processing all parsed days (the full planning horizon) ---
    // The keys are sorted to ensure the subsequent scheduler loop iterates chronologically.
    const sortedDayKeys = Object.keys(dayRequirements).map(Number).sort((a, b) => a - b);
    const allDays = {};
    for(const key of sortedDayKeys) { allDays[key] = dayRequirements[key]; }
    
    return { days: allDays, employees: employeeData };
}

/**
 * Implements a Minimum Cost Greedy Heuristic for scheduling.
 * It prioritizes filling required slots with the cheapest single employee who is qualified.
 */
function runScheduler(data) {
    const { days, employees } = data;
    const schedule = {};
    const employeeHours = {}; 
    
    // Initialize hours worked for the week
    // Note: The Codebash challenge is weekly-resetting, but since the planning horizon
    // is large, we treat it as a continuous limit enforcement for this heuristic.
    for (const id in employees) { employeeHours[id] = 0; }

    const sortedDayIds = Object.keys(days).map(Number).sort((a, b) => a - b);

    for (const dayId of sortedDayIds) {
        const day = days[dayId];
        
        // Reset employee hours counter weekly (every 7 days, starting from Day 0)
        if (dayId % 7 === 0) {
            for (const id in employeeHours) {
                employeeHours[id] = 0;
            }
        }

        if (!day.open) {
            // Output for a closed day: day_id _
            schedule[dayId] = [`${dayId}_`];
            continue;
        }

        const dailyShifts = [];
        
        // Convert requiredSlots into a list of required 1-hour shift objects: [ {hour, skill} ]
        let requiredShifts = [];
        for (const hourSkill in day.requiredSlots) {
            const count = day.requiredSlots[hourSkill];
            const [hour, skill] = hourSkill.split('-');
            for (let i = 0; i < count; i++) {
                requiredShifts.push({ hour: parseInt(hour, 10), skill });
            }
        }

        // Sort shifts to prioritize coverage based on time
        requiredShifts.sort((a, b) => a.hour - b.hour);

        // --- Greedy Assignment ---
        for (const shiftReq of requiredShifts) {
            const { hour, skill } = shiftReq;
            
            let bestEmployee = null;
            let minCost = Infinity;

            // Find the best single employee (cheapest, qualified, available)
            for (const empId in employees) {
                const employee = employees[empId];
                
                // Constraints Check
                if (!employee.skills.has(skill)) continue; // Skill Match
                if (employee.vacationDays.has(dayId)) continue; // Vacation
                if (employeeHours[empId] >= employee.maxHoursPerWeek) continue; // Weekly Max Hours
                
                // Daily Conflict Check: Employee must be available for this specific hour slot
                const isAlreadyScheduled = dailyShifts.some(shift => 
                    shift.employee_id === employee.id && shift.start <= hour && shift.end > hour
                );
                if (isAlreadyScheduled) continue;

                // Greedy Choice: Lowest salary (Minimum Cost)
                if (employee.salaryPerHour < minCost) {
                    minCost = employee.salaryPerHour;
                    bestEmployee = employee;
                }
            }

            if (bestEmployee) {
                const shiftStart = hour;
                const shiftEnd = hour + 1;
                
                // Merge consecutive shifts for the same employee/skill (required by output format)
                let merged = false;
                for (let i = dailyShifts.length - 1; i >= 0; i--) {
                    const lastShift = dailyShifts[i];
                    if (lastShift.employee_id === bestEmployee.id && 
                        lastShift.end === shiftStart && 
                        lastShift.skill === skill) {
                        
                        lastShift.end = shiftEnd; // Extend the shift duration
                        merged = true;
                        break;
                    }
                }
                
                if (!merged) {
                    dailyShifts.push({ employee_id: bestEmployee.id, start: shiftStart, end: shiftEnd, skill: skill });
                }
                
                // Update hours worked
                employeeHours[bestEmployee.id]++;
            }
        }
        
        // --- Format Output for the Day ---
        const outputTokens = dailyShifts.map(s => `${s.employee_id}-${s.start}-${s.end}-${s.skill}`);
        
        // Output: day_id shift_token shift_token ... OR day_id _
        if (outputTokens.length > 0) {
            schedule[dayId] = [`${dayId} ${outputTokens.join(' ')}`];
        } else if (day.open) {
             // Day is open but no shifts were assigned
             schedule[dayId] = [`${dayId}_`];
        }
    }
    
    // --- Generate Final Output File Content ---
    let finalOutput = '';
    for (const dayId of sortedDayIds) {
        if (schedule[dayId]) {
             finalOutput += schedule[dayId].join('\n') + '\n';
        }
    }
    
    return finalOutput.trim();
}

/** Main function to run the script */
function main() {
    const inputFileName = 'examples/H_Mentoring.txt';
    const outputFileName = 'output.txt';

    try {
        const content = fs.readFileSync(inputFileName, 'utf8');
        const data = parseInput(content);
        const outputContent = runScheduler(data);
        
        fs.writeFileSync(outputFileName, outputContent);
        console.log(`✅ Successfully generated a schedule for all days (${Object.keys(data.days).length} days) and saved to ${outputFileName}`);
        console.log(`\n--- Preview of ${outputFileName} (First 10 lines) ---\n${outputContent.split('\n').slice(0, 10).join('\n')}`);

    } catch (error) {
        console.error(`❌ An error occurred: ${error.message}`);
        console.error(`Please ensure the file "${inputFileName}" exists in the same directory and Node.js is installed.`);
    }
}

// Execute the main function
main();
