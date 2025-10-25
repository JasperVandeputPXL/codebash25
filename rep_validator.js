const fs = require('fs');
const path = require('path');

// --- Data Structures ---

/**
 * Stores global cost and modifier settings.
 */
class Organization {
    constructor(overtimeModPercent, fixedCost) {
        this.overtimeMod = parseInt(overtimeModPercent);
        this.fixedCost = parseInt(fixedCost);
    }
}

/**
 * Stores all information about a single calendar day.
 */
class Day {
    constructor(lineParts) {
        this.id = parseInt(lineParts[0]);
        this.isClosed = lineParts.length === 1;
        this.start = this.isClosed ? 0 : parseInt(lineParts[1]);
        this.end = this.isClosed ? 0 : parseInt(lineParts[2]);
        this.revenue = this.isClosed ? 0 : parseInt(lineParts[3]);
        
        // Handle required_skills_csv
        if (!this.isClosed && lineParts.length > 4) {
            this.requiredSkills = lineParts[4].split(',');
        } else {
            this.requiredSkills = [];
        }

        this.duration = this.end - this.start;
    }
    
    /**
     * Calculates the denominator for capacity: duration * number of required skills.
     */
    totalSkillHours() {
        if (this.isClosed) {
            return 0;
        }
        return this.duration * this.requiredSkills.length;
    }
}

/**
 * Stores employee base data, including initial skills and vacation days.
 */
class Employee {
    constructor(lineParts) {
        this.id = parseInt(lineParts[0]);
        this.maxHoursPerWeek = parseInt(lineParts[1]);
        this.salaryPerHour = parseInt(lineParts[2]);
        this.learningRate = parseInt(lineParts[3]);
        this.teachingRate = parseInt(lineParts[4]);
        
        this.initialSkills = new Set();
        if (lineParts[5] !== '_') {
            lineParts[5].split(',').forEach(skill => this.initialSkills.add(skill));
        }
            
        this.vacationDays = new Set();
        if (lineParts[6] !== '_') {
            lineParts[6].split(',').map(d => parseInt(d)).forEach(dayId => this.vacationDays.add(dayId));
        }
    }
}

/**
 * Represents a scheduled shift from the output file.
 */
class Shift {
    constructor(token) {
        const parts = token.split('-');
        this.employeeId = parseInt(parts[0]);
        this.start = parseInt(parts[1]);
        this.end = parseInt(parts[2]);
        this.skill = parts[3];
        this.duration = this.end - this.start;
        
        if (this.duration <= 0) {
            throw new Error(`Shift duration is invalid or zero/negative: ${token}`);
        }
    }
}

// --- Core Validator Class ---

class PlanningValidator {
    constructor(inputPath, outputPath) {
        this.inputPath = inputPath;
        this.outputPath = outputPath;
        
        // Data populated during parsing
        this.organization = null;
        this.days = {}; // {day_id: Day object}
        this.employees = {}; // {emp_id: Employee object}
        this.schedule = {}; // {day_id: list of Shift objects}

        // Dynamic state for scoring
        // {emp_id: {skill_name: points}}
        this.skillPoints = {};
        // {emp_id: hours} for current 7-day week
        this.weeklyHours = {};
        
        // Results
        this.totalProfit = 0;
        this.totalPayroll = 0;
        this.totalRevenuePotential = 0;
        this.isValid = true;
        this.validationErrors = [];
    }

    /**
     * Records an error and flags the schedule as invalid.
     */
    _logError(message) {
        if (!this.validationErrors.includes(message)) {
            this.validationErrors.push(message);
        }
        this.isValid = false;
    }

    // --- 1. Parsing ---

    /**
     * Parses the input file into internal data structures.
     */
    parseInput() {
        console.log(`--- Parsing Input File: ${this.inputPath} ---`);
        let lines;
        try {
            const content = fs.readFileSync(this.inputPath, 'utf8').trim();
            lines = content.split('\n').filter(line => line.trim() !== '');
        } catch (e) {
            this._logError(`Input file not found or inaccessible: ${this.inputPath}`);
            return;
        }
        
        // Organization
        const orgLine = lines[0].split(/\s+/);
        if (orgLine.length !== 2) {
            this._logError("Invalid organization line format.");
            return;
        }
        this.organization = new Organization(...orgLine);

        // Days
        const numDays = parseInt(lines[1].trim());
        const dayLines = lines.slice(2, 2 + numDays);
            
        if (dayLines.length !== numDays) {
            this._logError(`Expected ${numDays} days, found ${dayLines.length} lines.`);
            return;
        }
            
        for (const line of dayLines) {
            const day = new Day(line.split(/\s+/));
            this.days[day.id] = day;
        }

        // Employees
        const employeeLines = lines.slice(2 + numDays);
        for (const line of employeeLines) {
            const emp = new Employee(line.split(/\s+/));
            this.employees[emp.id] = emp;
            
            // Initialize skill points with initial skills (1000 points)
            this.skillPoints[emp.id] = this.skillPoints[emp.id] || {};
            emp.initialSkills.forEach(skill => {
                 this.skillPoints[emp.id][skill] = 1000;
            });
        }
        
        console.log(`Input successfully parsed: ${Object.keys(this.days).length} days, ${Object.keys(this.employees).length} employees.`);
    }

    /**
     * Parses the output schedule file.
     */
    parseOutput() {
        console.log(`--- Parsing Output File: ${this.outputPath} ---`);
        let outputLines;
        try {
            const content = fs.readFileSync(this.outputPath, 'utf8').trim();
            outputLines = content.split('\n').filter(line => line.trim() !== '');
        } catch (e) {
            this._logError(`Output file not found or inaccessible: ${this.outputPath}`);
            return;
        }

        const expectedDayCount = Object.keys(this.days).length;
        if (outputLines.length !== expectedDayCount) {
             this._logError(`Output line count (${outputLines.length}) does not match input day count (${expectedDayCount}).`);
             return;
        }

        for (const line of outputLines) {
            const parts = line.split(/\s+/);
            if (parts.length === 0) continue;

            const dayId = parseInt(parts[0]);
            
            if (isNaN(dayId) || dayId < 0) {
                this._logError(`Malformed day_id in output line: '${parts[0]}'`);
                continue;
            }
            
            if (!this.days[dayId]) {
                this._logError(`Output references non-existent day ID: ${dayId}`);
                continue;
            }

            // Handle closed or no-shift days
            if (parts.length === 2 && parts[1] === '_') {
                this.schedule[dayId] = [];
                continue;
            }
            
            const day = this.days[dayId];
            const shiftTokens = parts.slice(1);
            
            // Check for closed day violation
            if (day.isClosed && shiftTokens.length > 0) {
                this._logError(`Day ${dayId} is closed but has shifts assigned.`);
                this.schedule[dayId] = [];
                continue;
            }

            // Parse shifts
            const shifts = [];
            for (const token of shiftTokens) {
                try {
                    shifts.push(new Shift(token));
                } catch (e) {
                    this._logError(`Malformed shift token on Day ${dayId}: '${token}'. Error: ${e.message}`);
                }
            }
            
            this.schedule[dayId] = shifts;
        }
        
        console.log("Output successfully parsed and mapped to schedule.");
    }

    // --- 2. Validity Checks & Scoring Helpers ---

    /**
     * Checks if an employee is trained (1000+ points) in a skill.
     */
    isTrained(empId, skill) {
        // Ensure the employee's skill map exists
        this.skillPoints[empId] = this.skillPoints[empId] || {};
        return (this.skillPoints[empId][skill] || 0) >= 1000;
    }

    /**
     * Calculates the payroll cost for a shift, accounting for weekly limits and overtime.
     */
    calculatePayroll(empId, shiftDuration) {
        const employee = this.employees[empId];
        
        // Ensure weekly hours tracking is initialized
        this.weeklyHours[empId] = this.weeklyHours[empId] || 0;
        
        // Hours remaining until max_hours_per_week is hit
        const baseHoursRemaining = employee.maxHoursPerWeek - this.weeklyHours[empId];
        
        const baseHours = Math.min(shiftDuration, Math.max(0, baseHoursRemaining));
        const overtimeHours = shiftDuration - baseHours;
        
        // Overtime calculation: floor(salary * modifier / 100)
        // Note: Using Math.floor is crucial as per competition rules.
        const overtimeRate = Math.floor(employee.salaryPerHour * this.organization.overtimeMod / 100);

        const cost = (baseHours * employee.salaryPerHour) + (overtimeHours * overtimeRate);
        
        // Update weekly hours for the employee (state change)
        this.weeklyHours[empId] += shiftDuration;
        
        return cost;
    }

    /**
     * Calculates the achieved capacity (Cd) and total payroll (Pd) for a day.
     * Also runs key validity checks for the day.
     */
    calculateCapacity(dayId, shifts) {
        const day = this.days[dayId];
        
        // Track hourly coverage: {hour: {skill: [trained_count, untrained_count]}}
        const coverageMap = {}; 

        // Check for overlapping shifts and time/vacation violations
        const employeeShiftsToday = {}; // {emp_id: [[start, end], ...]}
        
        let payrollD = 0;
        
        for (const shift of shifts) {
            const emp = this.employees[shift.employeeId];
            if (!emp) {
                this._logError(`Day ${dayId}: Shift uses non-existent employee ID ${shift.employeeId}`);
                continue;
            }
            
            // Validity Check 1: Vacation
            if (emp.vacationDays.has(dayId)) {
                this._logError(`Day ${dayId}: Employee ${shift.employeeId} scheduled on vacation day.`);
            }
            
            // Validity Check 2: Shift outside store hours
            if (shift.start < day.start || shift.end > day.end) {
                this._logError(`Day ${dayId}: Shift ${shift.employeeId}-${shift.start}-${shift.end} is outside store hours (${day.start}-${day.end}).`);
            }

            // Validity Check 3: Overlapping shifts for same employee
            employeeShiftsToday[shift.employeeId] = employeeShiftsToday[shift.employeeId] || [];
            let overlap = false;
            for (const [sStart, sEnd] of employeeShiftsToday[shift.employeeId]) {
                // Check for overlap: max(start1, start2) < min(end1, end2)
                if (Math.max(shift.start, sStart) < Math.min(shift.end, sEnd)) {
                    this._logError(`Day ${dayId}: Employee ${shift.employeeId} has overlapping shifts.`);
                    overlap = true;
                    break;
                }
            }
            if (!overlap) {
                employeeShiftsToday[shift.employeeId].push([shift.start, shift.end]);
            }
            
            // --- Coverage Calculation & Payroll ---
            
            // Add to daily payroll (state change happens inside calculatePayroll)
            payrollD += this.calculatePayroll(shift.employeeId, shift.duration);
            
            const isEmpTrained = this.isTrained(shift.employeeId, shift.skill);
            
            // Update hourly coverage map
            for (let h = shift.start; h < shift.end; h++) {
                coverageMap[h] = coverageMap[h] || {};
                coverageMap[h][shift.skill] = coverageMap[h][shift.skill] || [0, 0]; // [trained_count, untrained_count]

                if (isEmpTrained) {
                    coverageMap[h][shift.skill][0] += 1; // Trained count
                } else {
                    coverageMap[h][shift.skill][1] += 1; // Untrained count
                }
            }
        }

        // Calculate achieved skill-hours (numerator)
        let achievedSkillHours = 0;
        
        // Track max teaching rate for training update: {hour: {skill: max_teaching_rate}}
        const hourlyTeachers = {}; 

        for (const skill of day.requiredSkills) {
            for (let h = day.start; h < day.end; h++) {
                const hourCoverage = coverageMap[h] && coverageMap[h][skill] ? coverageMap[h][skill] : [0, 0];
                const trainedCount = hourCoverage[0];
                const untrainedCount = hourCoverage[1];
                let hourlyCoverage = 0.0;
                
                if (trainedCount > 0) {
                    hourlyCoverage = 1.0;
                    
                    // Track max teaching rate for training update
                    let maxRate = 0;
                    for (const shift of shifts) {
                        if (shift.skill === skill && shift.start <= h && h < shift.end && this.isTrained(shift.employeeId, skill)) {
                            maxRate = Math.max(maxRate, this.employees[shift.employeeId].teachingRate);
                        }
                    }
                    hourlyTeachers[h] = hourlyTeachers[h] || {};
                    hourlyTeachers[h][skill] = maxRate;
                    
                } else if (untrainedCount === 1) {
                    hourlyCoverage = 0.5;
                } else if (untrainedCount > 1) {
                    hourlyCoverage = 1.0;
                }
                    
                achievedSkillHours += hourlyCoverage;
            }
        }

        // Calculate final capacity
        const totalNeed = day.totalSkillHours();
        const capacityD = totalNeed > 0 ? achievedSkillHours / totalNeed : 0.0;

        return { capacityD, payrollD, hourlyTeachers };
    }
    
    /**
     * Updates employee skill points based on shifts and teaching bonuses.
     */
    updateTraining(dayId, shifts, hourlyTeachers) {
        
        // Track which employees worked which skill for which hour
        // {emp_id: {skill: [hours]}}
        const empSkillHours = {}; 

        for (const shift of shifts) {
            empSkillHours[shift.employeeId] = empSkillHours[shift.employeeId] || {};
            empSkillHours[shift.employeeId][shift.skill] = empSkillHours[shift.employeeId][shift.skill] || [];
            
            for (let h = shift.start; h < shift.end; h++) {
                empSkillHours[shift.employeeId][shift.skill].push(h);
            }
        }

        // Apply training gain
        for (const empId in empSkillHours) {
            if (!empSkillHours.hasOwnProperty(empId)) continue;
            
            const employee = this.employees[empId];
            const skillsWorked = empSkillHours[empId];
            
            for (const skill in skillsWorked) {
                if (!skillsWorked.hasOwnProperty(skill)) continue;

                // Only apply learning if not already trained
                if (this.isTrained(parseInt(empId), skill)) {
                    continue;
                }
                
                let totalGain = 0;
                for (const h of skillsWorked[skill]) {
                    const baseGain = employee.learningRate;
                    
                    // Check for teaching bonus
                    const teacherRate = (hourlyTeachers[h] && hourlyTeachers[h][skill]) || 0;
                    
                    const gain = teacherRate > 0 ? baseGain * teacherRate : baseGain;
                        
                    totalGain += gain;
                }
                
                this.skillPoints[empId][skill] = (this.skillPoints[empId][skill] || 0) + totalGain;
            }
        }
    }

    /**
     * Main loop to process all days, check validity, and calculate score.
     */
    validateAndScore() {
        
        // Check initial parsing validity
        if (!this.isValid) {
            return;
        }

        // Days must be processed in strict order (0, 1, 2, ...)
        const dayIds = Object.keys(this.days).map(id => parseInt(id)).sort((a, b) => a - b);
        
        for (const dayId of dayIds) {
            const day = this.days[dayId];
            const shifts = this.schedule[dayId] || [];
            
            // --- 1. Weekly Hour Reset ---
            if (dayId % 7 === 0) {
                // Reset weekly hours at the start of day 0, 7, 14, etc.
                this.weeklyHours = {};
            }

            let profitD = 0;
            let capacityD = 0.0;
            let payrollD = 0;
            let hourlyTeachers = null;
            
            // --- 2. Calculate Day Metrics & Run Checks ---
            if (day.isClosed) {
                // Closed day: C=0, R=0, P=0. Profit = -F
                profitD = -this.organization.fixedCost;
            } else {
                // Open Day
                const metrics = this.calculateCapacity(dayId, shifts);
                capacityD = metrics.capacityD;
                payrollD = metrics.payrollD;
                hourlyTeachers = metrics.hourlyTeachers;
                
                // Score calculation: Profit = Revenue * Capacity^2 - Payroll - FixedCost
                const capacitySq = capacityD ** 2;
                profitD = (day.revenue * capacitySq) - payrollD - this.organization.fixedCost;
                
                // Update employee skills based on the schedule
                this.updateTraining(dayId, shifts, hourlyTeachers);
            }

            // --- 3. Accumulate Totals ---
            this.totalProfit += profitD;
            this.totalPayroll += payrollD;
            this.totalRevenuePotential += day.revenue;
        }

        // --- 4. Final Output ---
        
        console.log("\n" + "=".repeat(50));
        console.log("  SCORECARD & VALIDATION RESULTS");
        console.log("=".repeat(50));
        
        if (this.isValid) {
            console.log("STATUS: VALID SCHEDULE");
            console.log("-".repeat(50));
            console.log(`Total Profit (Final Score): ${this.totalProfit.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`);
            console.log(`Total Payroll Cost: ${this.totalPayroll.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`);
            console.log(`Total Revenue Potential: ${this.totalRevenuePotential.toLocaleString()}`);
            console.log(`Total Fixed Costs Incurred: ${(dayIds.length * this.organization.fixedCost).toLocaleString()}`);
        } else {
            console.log("STATUS: INVALID SCHEDULE (Score: 0)");
            console.log("-".repeat(50));
            console.log("ERRORS FOUND:");
            for (let i = 0; i < this.validationErrors.length; i++) {
                console.log(`  ${i + 1}. ${this.validationErrors[i]}`);
            }
            console.log("-".repeat(50));
            console.log("Score is 0 due to invalidity.");
        }
    }
}

// --- Execution ---

if (typeof require !== 'undefined' && require.main === module) {
    if (process.argv.length !== 4) {
        console.log("Usage: node validator.js <input_file_path> <output_file_path>");
        process.exit(1);
    }

    const inputPath = process.argv[2];
    const outputPath = process.argv[3];
    
    const validator = new PlanningValidator(inputPath, outputPath);
    
    // 1. Parse Input & Output
    validator.parseInput();
    validator.parseOutput();
    
    // 2. Validate and Score
    validator.validateAndScore();
}
