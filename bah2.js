const fs = require('fs');

// --- Global Constants and Data Structures ---

const INPUT_FILE = 'D_Multi_Month.txt';
const OUTPUT_FILE = 'output.txt';

// Data structures to hold parsed data
let OVERTIME_MODIFIER_PERCENT = 0;
let FIXED_DAILY_COST = 0;
let calendarDays = [];
let employees = new Map();

// Weekly tracking, starting from day 1
let employeeHoursWorked = new Map(); 

// Training points tracking
let employeeSkillPoints = new Map(); 

// --- Input Parsing Functions ---

function parseInput(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n').filter(line => line.trim().length > 0);

    // 1. Organization (Line 1)
    const orgData = lines.shift().split(' ').map(Number);
    OVERTIME_MODIFIER_PERCENT = orgData[0];
    FIXED_DAILY_COST = orgData[1];

    // 2. Days (Line 2 and subsequent lines)
    const numDays = Number(lines.shift());
    for (let i = 1; i <= numDays; i++) {
        const dayLine = lines.shift().split(' ');
        const dayId = Number(dayLine[0]);
        let day = { id: dayId, is_open: false, shifts: [] };

        if (dayLine.length > 1) { // Open Day
            day.is_open = true;
            day.start = Number(dayLine[1]);
            day.end = Number(dayLine[2]);
            day.revenue = Number(dayLine[3]);
            day.required_skills = dayLine[4].split(',').filter(s => s.trim() !== '');
            day.duration = day.end - day.start;
            day.total_required_skill_hours = day.duration * day.required_skills.length;
        }
        calendarDays.push(day);
    }

    // 3. Employees (Remaining lines)
    while (lines.length > 0) {
        const employeeData = lines.shift().split(' ');
        const id = Number(employeeData[0]);
        const employee = {
            id: id,
            max_hours_per_week: Number(employeeData[1]),
            salary_per_hour: Number(employeeData[2]),
            learning_rate: Number(employeeData[3]),
            teaching_rate: Number(employeeData[4]),
            skills: employeeData[5] === '_' ? new Set() : new Set(employeeData[5].split(',')),
            vacation_days: employeeData[6] === '_' ? new Set() : new Set(employeeData[6].split(',').map(Number)),
            shifts: []
        };
        employees.set(id, employee);
        employeeHoursWorked.set(id, 0); // Initialize weekly hours
        employeeSkillPoints.set(id, new Map()); // Initialize skill points
        employee.skills.forEach(skill => employeeSkillPoints.get(id).set(skill, 1000)); // Start trained skills at 1000
    }
}

// --- Scheduling Helper Functions ---

/**
 * Checks if an employee can work on a given day/hour.
 */
function isEmployeeAvailable(employeeId, dayId, startHour, endHour) {
    const employee = employees.get(employeeId);
    if (employee.vacation_days.has(dayId)) {
        return false;
    }
    
    // Check for overlapping shifts *on this day*
    const scheduledShifts = employee.shifts.filter(s => s.dayId === dayId);
    for (const shift of scheduledShifts) {
        // Shift is a half-open interval [shift.start, shift.end)
        // If the new shift [startHour, endHour) overlaps with [shift.start, shift.end)
        if (startHour < shift.end && endHour > shift.start) {
            return false;
        }
    }
    
    // Check shift is valid (start < end is handled by the main loop,
    // and full day window check is done in the main loop).
    return true;
}

/**
 * Calculates the cost for one hour for an employee, considering overtime.
 * Assumes this hour is *after* the hours already accrued this week.
 */
function calculateHourlyCost(employeeId) {
    const employee = employees.get(employeeId);
    const hoursThisWeek = employeeHoursWorked.get(employeeId);
    
    if (hoursThisWeek < employee.max_hours_per_week) {
        return employee.salary_per_hour; // Base pay
    } else {
        // Overtime pay = floor(base_salary_per_hour * overtime_modifier_percent/100)
        const overtimeRate = Math.floor(employee.salary_per_hour * OVERTIME_MODIFIER_PERCENT / 100);
        return overtimeRate;
    }
}

/**
 * Checks if an employee is trained in a skill.
 * Trained means skill points >= 1000.
 */
function isTrained(employeeId, skill) {
    const pointsMap = employeeSkillPoints.get(employeeId);
    return pointsMap.get(skill) >= 1000;
}

// --- Main Scheduling Logic (Greedy Heuristic) ---

function generateSchedule() {
    let outputLines = [];

    // The week always starts on the first day of the input.
    // Day IDs start at 1. Day 1 to Day 7 is week 1, 8 to 14 is week 2, etc.
    const HOURS_PER_WEEK = 7 * 24; // A large number for week tracking

    for (const day of calendarDays) {
        const dayId = day.id;

        // Reset weekly hours for all employees at the start of a new week (every 7 days)
        if ((dayId - 1) % 7 === 0 && dayId > 1) {
            for (const empId of employees.keys()) {
                employeeHoursWorked.set(empId, 0);
                employees.get(empId).shifts = employees.get(empId).shifts.filter(s => s.dayId >= dayId);
            }
        }

        if (!day.is_open) {
            // Closed day: day_id _
            outputLines.push(`${dayId} _`);
            continue;
        }

        let shiftsForDay = [];
        
        // 1. Identify all required skill-hours for the day
        let requiredSkillHours = []; // { hour: 8, skill: 'Register' }
        for (let hour = day.start; hour < day.end; hour++) {
            for (const skill of day.required_skills) {
                requiredSkillHours.push({ hour: hour, skill: skill });
            }
        }
        
        // --- Greedy Strategy: Prioritize required skill-hours (e.g., by revenue per skill-hour, 
        // which is uniform here, so no specific sort is needed other than by hour) ---

        for (const req of requiredSkillHours) {
            const { hour, skill } = req;
            let currentCoverage = 0;
            
            // Check current coverage from already scheduled shifts on this day/hour/skill
            // (A more advanced greedy would track this across all hours/skills for the day 
            // before deciding on the *next* shift, but for simplicity, we focus on one-hour shifts)
            const hourShifts = shiftsForDay.filter(s => 
                s.skill === skill && s.start <= hour && s.end > hour
            );

            for (const shift of hourShifts) {
                const isEmpTrained = isTrained(shift.employeeId, skill);
                currentCoverage += isEmpTrained ? 1 : 0.5;
            }

            // Only schedule if coverage is not full (less than 1.0)
            if (currentCoverage < 1.0) {
                
                // Determine the needed coverage amount for this hour/skill
                const neededCoverage = 1.0 - currentCoverage;
                
                // Find the best employee to cover the needed amount
                let bestEmployee = null;
                let minCost = Infinity;

                // Simple metric: Cost-effectiveness = (Coverage_Added / Hourly_Cost)
                // Since Coverage_Added is 1 or 0.5, this simplifies.
                // Priority: Trained, then cheapest.
                
                // Get available employees, sorted by skill/cost
                const availableEmployees = Array.from(employees.values())
                    .filter(emp => isEmployeeAvailable(emp.id, dayId, hour, hour + 1))
                    .sort((a, b) => {
                        const aTrained = isTrained(a.id, skill);
                        const bTrained = isTrained(b.id, skill);
                        
                        // 1. Prioritize trained employees (full coverage)
                        if (aTrained !== bTrained) {
                            return bTrained - aTrained; // Trained comes first
                        }

                        // 2. Prioritize base-hour employees (cheaper)
                        const aIsOvertime = employeeHoursWorked.get(a.id) >= a.max_hours_per_week;
                        const bIsOvertime = employeeHoursWorked.get(b.id) >= b.max_hours_per_week;
                        if (aIsOvertime !== bIsOvertime) {
                            return aIsOvertime - bIsOvertime; // Base-hour (non-overtime) comes first
                        }
                        
                        // 3. For tie-breaker, prioritize the one with the lowest hourly cost
                        const aCost = calculateHourlyCost(a.id);
                        const bCost = calculateHourlyCost(b.id);
                        return aCost - bCost;
                    });
                
                if (availableEmployees.length > 0) {
                    bestEmployee = availableEmployees[0];
                    
                    // --- Schedule the 1-hour shift ---
                    const newShift = {
                        employeeId: bestEmployee.id,
                        start: hour,
                        end: hour + 1,
                        skill: skill,
                        dayId: dayId
                    };

                    shiftsForDay.push(newShift);
                    
                    // Update employee tracking
                    bestEmployee.shifts.push(newShift);
                    employeeHoursWorked.set(bestEmployee.id, employeeHoursWorked.get(bestEmployee.id) + 1);

                    // Update training points (This is a simplified approach; a more complex one
                    // would track teachers and apply the teaching rate multiplier).
                    if (!isTrained(bestEmployee.id, skill)) {
                        const pointsMap = employeeSkillPoints.get(bestEmployee.id);
                        let pointsGained = bestEmployee.learning_rate;
                        
                        // Simplified teacher check (doesn't track highest teaching rate)
                        const hasTeacher = hourShifts.some(s => isTrained(s.employeeId, skill));
                        if (hasTeacher) {
                            // Find the max teaching rate of a co-scheduled trained employee (teacher)
                            let maxTeachingRate = 1; // Default multiplier
                            for (const shift of hourShifts) {
                                const teacher = employees.get(shift.employeeId);
                                if (isTrained(teacher.id, skill)) {
                                    maxTeachingRate = Math.max(maxTeachingRate, teacher.teaching_rate);
                                }
                            }
                            pointsGained *= maxTeachingRate;
                        }

                        pointsMap.set(skill, (pointsMap.get(skill) || 0) + pointsGained);
                        
                        // Check for skill acquisition
                        if (pointsMap.get(skill) >= 1000) {
                            bestEmployee.skills.add(skill);
                        }
                    }
                }
            }
        }
        
        // --- Output Formatting and Shift Merging ---
        
        // Group and merge shifts for the same employee/skill to a single token (e.g., 8-9 and 9-10 becomes 8-10)
        let finalTokens = [];
        let groupedShifts = new Map(); // Key: 'employeeId-skill', Value: [{start, end}]

        for (const shift of shiftsForDay) {
            const key = `${shift.employeeId}-${shift.skill}`;
            if (!groupedShifts.has(key)) {
                groupedShifts.set(key, []);
            }
            groupedShifts.get(key).push({ start: shift.start, end: shift.end });
        }

        for (const [key, shifts] of groupedShifts.entries()) {
            const [employeeId, skill] = key.split('-');
            
            // Sort by start time
            shifts.sort((a, b) => a.start - b.start);

            // Merge consecutive shifts
            let merged = [];
            let current = shifts[0];

            for (let i = 1; i < shifts.length; i++) {
                if (shifts[i].start === current.end) {
                    current.end = shifts[i].end; // Merge
                } else {
                    merged.push(current);
                    current = shifts[i]; // Start a new block
                }
            }
            merged.push(current); // Push the last block

            // Convert merged blocks to shift tokens
            for (const m of merged) {
                finalTokens.push(`${employeeId}-${m.start}-${m.end}-${skill}`);
            }
        }
        
        // Output the line
        if (finalTokens.length === 0) {
            outputLines.push(`${dayId} _`);
        } else {
            outputLines.push(`${dayId} ${finalTokens.join(' ')}`);
        }
    }
    
    // Write to output file
    fs.writeFileSync(OUTPUT_FILE, outputLines.join('\n'));
    console.log(`Schedule generated and written to ${OUTPUT_FILE}`);
}

// --- Execution ---

try {
    parseInput(INPUT_FILE);
    generateSchedule();
} catch (error) {
    console.error('An error occurred during scheduling:', error);
}