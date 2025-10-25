#!/usr/bin/env node

/**
 * CodeBash 2025 Planning Challenge Solver Framework
 *
 * This script provides a complete framework for parsing the input,
 * validating a schedule, calculating the score, and generating
 * a valid output file.
 *
 * TO USE:
 * 1. Save this file as `solve.js`.
 * 2. Run `node solve.js F_Decade.txt output.txt` in your terminal.
 * 3.
 * 4. *** YOUR TASK ***
 * Modify this `generateSchedule()` method. This version is
 * a solid baseline that prioritizes 100% capacity.
 */

const fs = require('fs');
const path = require('path');

// --- DATA MODELS ---

/**
 * Represents a single shift assignment for an employee. [cite: 71-72]
 */
class Shift {
  /**
   * @param {number} employeeId
   * @param {number} start Hour (inclusive)
   * @param {number} end Hour (exclusive)
   * @param {string} skill
   */
  constructor(employeeId, start, end, skill) {
    this.employeeId = employeeId;
    this.start = start;
    this.end = end;
    this.skill = skill;
  }

  /**
   * Formats the shift for the output file.
   * @returns {string}
   */
  toString() {
    return `${this.employeeId}-${this.start}-${this.end}-${this.skill}`;
  }
}

/**
 * Represents a single day in the planning horizon. [cite: 39-48]
 */
class Day {
  /**
   * @param {number} id
   * @param {boolean} isOpen
   * @param {number} start
   * @param {number} end
   * @param {number} dailyRevenue
   * @param {string[]} requiredSkills
   */
  constructor(id, isOpen, start = 0, end = 0, dailyRevenue = 0, requiredSkills = []) {
    this.id = id;
    this.isOpen = isOpen;
    this.start = start;
    this.end = end;
    this.dailyRevenue = dailyRevenue;
    this.requiredSkills = requiredSkills;
  }

  /**
   * @returns {number}
   */
  get duration() {
    return this.isOpen ? this.end - this.start : 0;
  }

  /**
   * Total skill-hours needed for 100% capacity.
   * @returns {number}
   */
  get totalRequiredSkillHours() {
    return this.isOpen ? this.duration * this.requiredSkills.length : 0;
  }
}

/**
 * Represents an employee and their base attributes. [cite: 50-61]
 */
class Employee {
  /**
   * @param {number} id
   * @param {number} maxHoursPerWeek
   * @param {number} salaryPerHour
   * @param {number} learningRate
   * @param {number} teachingRate
   * @param {Set<string>} knownSkills
   * @param {Set<number>} vacationDays
   */
  constructor(id, maxHoursPerWeek, salaryPerHour, learningRate, teachingRate, knownSkills, vacationDays) {
    this.id = id;
    this.maxHoursPerWeek = maxHoursPerWeek;
    this.salaryPerHour = salaryPerHour;
    this.learningRate = learningRate;
    this.teachingRate = teachingRate;
    this.knownSkills = knownSkills;
    this.vacationDays = vacationDays;
  }

  /**
   * Creates a deep copy for simulation purposes.
   * @returns {Employee}
   */
  clone() {
    return new Employee(
      this.id,
      this.maxHoursPerWeek,
      this.salaryPerHour,
      this.learningRate,
      this.teachingRate,
      new Set(this.knownSkills), // Deep copy skills
      this.vacationDays // Vacations are static, no deep copy needed
    );
  }
}

/**
 * Tracks the dynamic state of an employee during simulation.
 */
class EmployeeState {
  constructor() {
    // Tracks hours worked per week index
    this.weeklyHours = {}; // { 0: 5, 1: 8, ... }
    // Tracks training points per skill
    this.trainingPoints = {}; // { 'skill': 150, ... }
  }

  /**
   * @param {number} dayId
   * @returns {number}
   */
  getWeekIndex(dayId) {
    return Math.floor((dayId - 1) / 7); // [cite: 62-63]
  }

  /**
   * @param {number} dayId
   * @returns {number}
   */
  getHoursThisWeek(dayId) {
    const weekIndex = this.getWeekIndex(dayId);
    return this.weeklyHours[weekIndex] || 0;
  }

  /**
   * @param {number} dayId
   */
  addHour(dayId) {
    const weekIndex = this.getWeekIndex(dayId);
    this.weeklyHours[weekIndex] = (this.weeklyHours[weekIndex] || 0) + 1;
  }

  /**
   * @param {string} skill
   * @returns {number}
   */
  getTrainingPoints(skill) {
    return this.trainingPoints[skill] || 0;
  }

  /**
   * @param {string} skill
   * @param {number} points
   */
  addTrainingPoints(skill, points) {
    this.trainingPoints[skill] = (this.trainingPoints[skill] || 0) + points;
  }
}

// --- MAIN SOLVER CLASS ---

class CodeBashSolver {
  constructor() {
    /** @type {{overtimeModifierPercent: number, fixedDailyCost: number}} */
    this.organization = {};
    /** @type {Day[]} */
    this.days = [];
    /** @type {Map<number, Employee>} */
    this.employees = new Map();
  }

  // --- 1. INPUT PARSING ---

  /**
   * Parses the input file and populates the data models.
   * @param {string} filePath
   */
  parseInput(filePath) {
    console.log(`Parsing input file: ${filePath}`);
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean);

    let lineIndex = 0;

    try {
      // 1. Parse Organization
      if (lines.length < 2) throw new Error("Input file is too short.");
      
      const [overtime, fixedCost] = lines[lineIndex].split(' ').map(Number);
      this.organization = {
        overtimeModifierPercent: overtime,
        fixedDailyCost: fixedCost,
      };
      lineIndex++; // Move to next line (day count)

      // 2. Parse Day Count
      const dayCount = Number(lines[lineIndex]);
      if (isNaN(dayCount) || dayCount < 0) throw new Error(`Invalid day count: ${lines[lineIndex]}`);
      lineIndex++; // Move to first day line

      // 3. Parse Days [cite: 136-139]
      const endOfDayLines = lineIndex + dayCount;
      if (lines.length < endOfDayLines) throw new Error(`Expected ${dayCount} day lines, but file ended early.`);

      for (let i = lineIndex; i < endOfDayLines; i++) {
        const dayParts = lines[i].split(' ');
        const dayId = Number(dayParts[0]);
        
        if (dayParts.length > 1) { // Open Day
          const [start, end, revenue] = dayParts.slice(1, 4).map(Number);
          const skills = dayParts[4].split(','); //
          this.days.push(new Day(dayId, true, start, end, revenue, skills));
        } else { // Closed Day
          this.days.push(new Day(dayId, false));
        }
      }
      
      lineIndex = endOfDayLines; // Set index to the first employee line

      // 4. Parse Employees
      while (lineIndex < lines.length) {
        const empParts = lines[lineIndex].split(' ');
        if (empParts.length < 7) {
            console.warn(`Skipping malformed employee line ${lineIndex + 1}: "${lines[lineIndex]}"`);
            lineIndex++;
            continue;
        }
        
        const id = Number(empParts[0]); //
        const [maxHours, salary, learning, teaching] = empParts.slice(1, 5).map(Number); //
        
        const skillsCsv = empParts[5];
        const skills = skillsCsv === '_' ? new Set() : new Set(skillsCsv.split(',')); //
        
        const vacationCsv = empParts[6];
        const vacations = vacationCsv === '_' ? new Set() : new Set(vacationCsv.split(',').map(Number)); //

        const employee = new Employee(id, maxHours, salary, learning, teaching, skills, vacations);
        this.employees.set(id, employee);
        lineIndex++;
      }
      
    } catch (e) {
      console.error(`Error parsing input file at line ${lineIndex + 1}: "${lines[lineIndex] || 'EOF'}"`);
      console.error(e.message);
      process.exit(1);
    }
    
    console.log(`Parsing complete. Found ${this.days.length} days and ${this.employees.size} employees.`);
  }

  // --- 2. SCHEDULING ALGORITHM (UPDATED) ---

  /**
   * Generates a schedule.
   *
   * *** THIS IS THE METHOD YOU NEED TO IMPROVE ***
   *
   * This logic now prioritizes 100% capacity to avoid the
   * negative score trap from the `capacity^2` rule.
   * It sorts employees by cost and tries to cover each skill with:
   * 1. One SKILLED employee 
   * 2. Or, TWO UNSKILLED employees 
   *
   * @returns {Map<number, Shift[]>} A map of `dayId` to an array of `Shift` objects.
   */
  generateSchedule() {
    console.log('Generating 100%-capacity-focused schedule...');
    /** @type {Map<number, Shift[]>} */
    const schedule = new Map();
    
    // This logic doesn't track weekly hours, but your *real*
    // algorithm will need to.
    
    for (const day of this.days) {
      const dailyShifts = [];
      
      if (!day.isOpen) {
        schedule.set(day.id, []);
        continue; // Closed day
      }

      // 1. Get all employees available today, sorted by cheapest first.
      const availableEmployees = [];
      for (const employee of this.employees.values()) {
        if (!employee.vacationDays.has(day.id)) { //
          availableEmployees.push(employee);
        }
      }
      availableEmployees.sort((a, b) => a.salaryPerHour - b.salaryPerHour); //

      const assignedEmployeeIds = new Set(); // Prevents overlaps [cite: 80, 127]

      for (const skill of day.requiredSkills) {
        
        // --- Strategy 1: Find 1 cheap SKILLED employee ---
        let covered = false;
        for (const emp of availableEmployees) {
          if (!assignedEmployeeIds.has(emp.id) && emp.knownSkills.has(skill)) {
            dailyShifts.push(new Shift(emp.id, day.start, day.end, skill));
            assignedEmployeeIds.add(emp.id);
            covered = true;
            break; // Skill covered, move to next skill
          }
        }

        if (covered) continue;

        // --- Strategy 2: Find 2 cheap UNSKILLED employees ---
        const unskilledNeeded = [];
        for (const emp of availableEmployees) {
          if (!assignedEmployeeIds.has(emp.id)) {
            // We already know they are unskilled from Strategy 1
            unskilledNeeded.push(emp);
            if (unskilledNeeded.length === 2) {
              break;
            }
          }
        }

        if (unskilledNeeded.length === 2) {
          const emp1 = unskilledNeeded[0];
          const emp2 = unskilledNeeded[1];
          
          dailyShifts.push(new Shift(emp1.id, day.start, day.end, skill));
          assignedEmployeeIds.add(emp1.id);
          
          dailyShifts.push(new Shift(emp2.id, day.start, day.end, skill));
          assignedEmployeeIds.add(emp2.id);
          
          covered = true;
        }
        
        if (covered) continue;

        // --- Strategy 3 (Fallback): Find 1 cheap UNSKILLED employee ---
        // This will only give 50% capacity, but it's better than 0%.
        // We only do this if we failed to find 2.
        for (const emp of availableEmployees) {
            if (!assignedEmployeeIds.has(emp.id)) {
                dailyShifts.push(new Shift(emp.id, day.start, day.end, skill));
                assignedEmployeeIds.add(emp.id);
                covered = true;
                break;
            }
        }

        // If not covered by now, we have no one left.
        
      } // next skill
      
      schedule.set(day.id, dailyShifts);
    } // next day
    
    console.log('New schedule generated.');
    return schedule;
  }

  // --- 3. VALIDATION ENGINE ---

  /**
   * Validates a generated schedule against all rules in Section 11. [cite: 124-128]
   * @param {Map<number, Shift[]>} schedule
   * @returns {boolean}
   */
  validateSchedule(schedule) {
    console.log('Validating schedule...');
    let isValid = true;
    const errors = [];

    // Rule: Number of lines == number of calendar days.
    if (schedule.size !== this.days.length) {
      errors.push(`Invalid line count: Expected ${this.days.length}, got ${schedule.size}`);
      isValid = false;
    }

    for (const day of this.days) {
      if (!schedule.has(day.id)) {
          errors.push(`Day ${day.id}: Missing day line in output.`);
          isValid = false;
          continue;
      }
      const shifts = schedule.get(day.id) || [];

      // Rule: Closed day contains any shift tokens.
      if (!day.isOpen && shifts.length > 0) {
        errors.push(`Day ${day.id} (Closed): Shifts are scheduled on a closed day.`);
        isValid = false;
      }

      const employeeShifts = new Map(); // For overlap checking

      for (const shift of shifts) {
        // Rule: A shift references unknown employee ID.
        if (!this.employees.has(shift.employeeId)) {
          errors.push(`Day ${day.id}: Shift ${shift} references unknown employee ${shift.employeeId}.`);
          isValid = false;
          continue; // Skip other checks for this bad shift
        }
        
        const employee = this.employees.get(shift.employeeId);

        // Rule: Employee scheduled on a vacation day.
        if (employee.vacationDays.has(day.id)) {
          errors.push(`Day ${day.id}: Employee ${employee.id} scheduled on vacation.`);
          isValid = false;
        }

        // Rule: Shift outside opening window.
        if (day.isOpen && (shift.start < day.start || shift.end > day.end)) {
          errors.push(`Day ${day.id}: Shift ${shift} is outside opening window [${day.start}, ${day.end}).`);
          isValid = false;
        }
        
        // Rule: Shift on a closed day.
        if (!day.isOpen) {
            // This is already covered by the rule, but good for defense.
            errors.push(`Day ${day.id}: Shift ${shift} scheduled on closed day.`);
            isValid = false;
        }

        // Rule: A shift with start >= end.
        if (shift.start >= shift.end) {
          errors.push(`Day ${day.id}: Shift ${shift} has start >= end.`);
          isValid = false;
        }

        // Rule: Overlapping shifts for same employee.
        if (!employeeShifts.has(employee.id)) {
          employeeShifts.set(employee.id, []);
        }
        const existingShifts = employeeShifts.get(employee.id);
        
        for (const existing of existingShifts) {
            // Check for overlap: max(start1, start2) < min(end1, end2)
            if (Math.max(shift.start, existing.start) < Math.min(shift.end, existing.end)) {
                errors.push(`Day ${day.id}: Employee ${employee.id} has overlapping shifts: ${shift} and ${existing}`);
                isValid = false;
            }
        }
        existingShifts.push(shift);
      }
    }

    if (!isValid) {
      console.error('--- SCHEDULE IS INVALID ---');
      errors.slice(0, 10).forEach(e => console.error(` - ${e}`));
      if (errors.length > 10) console.error(` ...and ${errors.length - 10} more errors.`);
    } else {
      console.log('Schedule is valid.');
    }
    return isValid;
  }

  // --- 4. SCORING ENGINE (SIMULATION) ---

  /**
   * Calculates the total score for a given schedule by running a full simulation. [cite: 167-171]
   * @param {Map<number, Shift[]>} schedule
   * @returns {number} The total score.
   */
  calculateScore(schedule) {
    console.log('Calculating score...');
    let totalScore = 0;

    // Create simulation-specific state
    const simEmployees = new Map();
    this.employees.forEach((emp, id) => simEmployees.set(id, emp.clone()));
    
    const employeeStates = new Map();
    this.employees.forEach((emp, id) => employeeStates.set(id, new EmployeeState()));

    // Process days in chronological order
    for (const day of this.days) {
      const fixedCost = this.organization.fixedDailyCost; //
      const shifts = schedule.get(day.id) || [];

      if (!day.isOpen) {
        totalScore -= fixedCost; //
        continue;
      }

      let dailyPayroll = 0;
      let achievedSkillHours = 0;
      
      const newSkillsLearned = new Map(); // Track promotions for *next* hour

      // --- Simulate hour by hour ---
      for (let h = day.start; h < day.end; h++) {
        
        // 1. Promote employees who learned skills *last* hour
        if (newSkillsLearned.size > 0) {
          for (const [empId, skill] of newSkillsLearned) {
            simEmployees.get(empId).knownSkills.add(skill);
          }
          newSkillsLearned.clear();
        }

        const activeShifts = shifts.filter(s => s.start <= h && s.end > h + 0);
        const activeEmployees = new Set(activeShifts.map(s => s.employeeId));
        
        // 2. Calculate Capacity for this hour [cite: 84-92]
        for (const skill of day.requiredSkills) {
          const shiftsForSkill = activeShifts.filter(s => s.skill === skill);
          if (shiftsForSkill.length === 0) continue; //

          const trainedEmployees = shiftsForSkill.filter(s => simEmployees.get(s.employeeId).knownSkills.has(skill));
          const untrainedEmployees = shiftsForSkill.filter(s => !simEmployees.get(s.employeeId).knownSkills.has(skill));

          if (trainedEmployees.length > 0) {
            achievedSkillHours += 1; //
          } else if (untrainedEmployees.length >= 2) {
            achievedSkillHours += 1; //
          } else if (untrainedEmployees.length === 1) {
            achievedSkillHours += 0.5; //
          }
        }
        
        // 3. Calculate Payroll for this hour [cite: 118-122]
        for (const empId of activeEmployees) {
          const employee = this.employees.get(empId);
          const state = employeeStates.get(empId);
          
          state.addHour(day.id);
          const hoursThisWeek = state.getHoursThisWeek(day.id);

          if (hoursThisWeek <= employee.maxHoursPerWeek) { //
            dailyPayroll += employee.salaryPerHour; //
          } else {
            const overtimePay = Math.floor(
              employee.salaryPerHour * this.organization.overtimeModifierPercent / 100
            ); //
            dailyPayroll += overtimePay;
          }
        }

        // 4. Calculate Training for this hour [cite: 107-116]
        const teachersBySkill = new Map(); // { 'skill': maxTeachingRate }
        const learners = [];

        for (const shift of activeShifts) {
          const employee = simEmployees.get(shift.employeeId);
          if (employee.knownSkills.has(shift.skill)) {
            // This employee is a potential teacher
            const currentMax = teachersBySkill.get(shift.skill) || 0;
            if (employee.teachingRate > currentMax) {
              teachersBySkill.set(shift.skill, employee.teachingRate); //
            }
          } else {
            // This employee is a learner
            learners.push(shift);
          }
        }

        for (const learnerShift of learners) {
          const learner = this.employees.get(learnerShift.employeeId);
          const state = employeeStates.get(learnerShift.employeeId);
          
          const teacherRate = teachersBySkill.get(learnerShift.skill);
          const multiplier = teacherRate > 0 ? teacherRate : 1; //
          
          const pointsGained = learner.learningRate * multiplier; //
          
          // Check if already trained this simulation
          if (!simEmployees.get(learner.id).knownSkills.has(learnerShift.skill)) {
            state.addTrainingPoints(learnerShift.skill, pointsGained);
            
            if (state.getTrainingPoints(learnerShift.skill) >= 1000) {
              // Mark for promotion *next* hour
              newSkillsLearned.set(learner.id, learnerShift.skill);
            }
          }
        }
      } // --- End of hourly loop ---

      // Calculate final day profit
      const capacityPercent = day.totalRequiredSkillHours > 0 ? (achievedSkillHours / day.totalRequiredSkillHours) : 0; //
      const revenue = day.dailyRevenue * (capacityPercent ** 2); //
      const dailyProfit = revenue - dailyPayroll - fixedCost;

      totalScore += dailyProfit;
    } // --- End of daily loop ---

    console.log(`Calculation complete. Total Score: ${totalScore}`);
    return totalScore;
  }

  // --- 5. OUTPUT FORMATTING ---

  /**
   * Formats the schedule into the required output string. [cite: 157-160]
   * @param {Map<number, Shift[]>} schedule
   * @returns {string}
   */
  formatOutput(schedule) {
    const outputLines = [];
    // Iterate in order of days
    for (const day of this.days) {
      const shifts = schedule.get(day.id) || [];
      
      if (shifts.length === 0) {
        outputLines.push(`${day.id} _`); //
      } else {
        const shiftStrings = shifts.map(s => s.toString());
        outputLines.push(`${day.id} ${shiftStrings.join(' ')}`); //
      }
    }
    return outputLines.join('\n');
  }

  // --- 6. MAIN EXECUTION ---

  /**
   * Runs the entire process: Parse, Schedule, Validate, Score, Write Output.
   * @param {string} inputFilePath
   * @param {string} outputFilePath
   */
  run(inputFilePath, outputFilePath) {
    // 1. Parse
    this.parseInput(inputFilePath);

    // 2. Schedule (This is where your magic happens)
    const schedule = this.generateSchedule();

    // 3. Validate
    const isValid = this.validateSchedule(schedule);
    if (!isValid) {
      console.error('Aborting due to invalid schedule. Output file will NOT be written.');
      return;
    }

    // 4. Score (Run the simulation)
    const score = this.calculateScore(schedule);

    // 5. Write Output
    const outputContent = this.formatOutput(schedule);
    try {
      fs.writeFileSync(outputFilePath, outputContent);
      console.log(`Successfully wrote output to: ${outputFilePath}`);
      console.log(`Final Score: ${score}`);
    } catch (e) {
      console.error(`Failed to write output file: ${e.message}`);
    }
  }
}

// --- SCRIPT ENTRY POINT ---

function main() {
  const args = process.argv.slice(2);
  const inputFilePath = args[0];
  const outputFilePath = args[1];

  if (!inputFilePath || !outputFilePath) {
    console.error('Error: You must provide an input and output file path.');
    console.log('Usage: node solve.js <input_file_F_Decade.txt> <output_file.txt>');
    process.exit(1);
  }
  
  if (!fs.existsSync(inputFilePath)) {
      console.error(`Error: Input file not found at ${inputFilePath}`);
      process.exit(1);
  }

  const solver = new CodeBashSolver();
  solver.run(inputFilePath, outputFilePath);
}

main();