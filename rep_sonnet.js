const fs = require('fs');

/**
 * Classic Chocolate Chip Cookies Recipe
 * 
 * Ingredients:
 * - 2 1/4 cups all-purpose flour
 * - 1 tsp baking soda
 * - 1 tsp salt
 * - 1 cup (2 sticks) butter, softened
 * - 3/4 cup granulated sugar
 * - 3/4 cup packed brown sugar
 * - 2 large eggs
 * - 2 tsp vanilla extract
 * - 2 cups chocolate chips
 * 
 * Instructions:
 * 1. Preheat oven to 375°F (190°C)
 * 2. Mix flour, baking soda, and salt in a bowl
 * 3. Beat butter and sugars until creamy
 * 4. Add eggs and vanilla, beat well
 * 5. Gradually blend in flour mixture
 * 6. Stir in chocolate chips
 * 7. Drop rounded tablespoons onto ungreased cookie sheets
 * 8. Bake 9-11 minutes until golden brown
 * 9. Cool on baking sheets for 2 minutes, then transfer to wire rack
 * 10. Enjoy with milk!
 */

class Scheduler {
  constructor() {
    this.overtimeModifier = 0;
    this.fixedDailyCost = 0;
    this.days = [];
    this.employees = [];
    this.schedule = [];
    this.employeeStates = []; // Track state per day
  }

  parseInput(filename) {
    const content = fs.readFileSync(filename, 'utf-8');
    const lines = content.trim().split('\n');
    let idx = 0;

    // Parse organization settings
    const [overtimeStr, fixedCostStr] = lines[idx++].split(' ');
    this.overtimeModifier = parseInt(overtimeStr);
    this.fixedDailyCost = parseInt(fixedCostStr);

    // Parse number of days
    const numDays = parseInt(lines[idx++]);

    // Parse days
    for (let i = 0; i < numDays; i++) {
      const parts = lines[idx++].split(' ');
      const dayId = parseInt(parts[0]);
      
      if (parts.length === 1) {
        this.days.push({ id: dayId, closed: true });
      } else {
        const start = parseInt(parts[1]);
        const end = parseInt(parts[2]);
        const revenue = parseInt(parts[3]);
        const skills = parts[4].split(',').map(s => s.trim());
        this.days.push({ id: dayId, closed: false, start, end, revenue, skills });
      }
    }

    // Parse employees
    while (idx < lines.length) {
      const parts = lines[idx++].split(' ');
      const employee = {
        id: parseInt(parts[0]),
        maxHours: parseInt(parts[1]),
        salary: parseInt(parts[2]),
        learningRate: parseInt(parts[3]),
        teachingRate: parseInt(parts[4]),
        skills: new Set(parts[5] === '_' ? [] : parts[5].split(',')),
        vacationSet: new Set(parts[6] === '_' ? [] : parts[6].split(',').map(Number))
      };
      this.employees.push(employee);
    }

    // Initialize employee states for each day
    this.employeeStates = this.employees.map(emp => ({
      skills: new Set(emp.skills),
      trainingProgress: {},
      hoursThisWeek: Array(this.days.length).fill(0)
    }));
  }

  generateSchedule() {
    this.schedule = new Array(this.days.length);
    
    for (let dayIdx = 0; dayIdx < this.days.length; dayIdx++) {
      const day = this.days[dayIdx];
      
      if (day.closed) {
        this.schedule[dayIdx] = [];
        continue;
      }

      const shifts = this.scheduleDay(dayIdx, day);
      this.schedule[dayIdx] = shifts;
      this.applyShifts(dayIdx, shifts);
    }
  }

  scheduleDay(dayIdx, day) {
    const shifts = [];
    const weekStart = Math.floor(dayIdx / 7) * 7;
    
    // Build skill coverage map
    const skillHourNeeds = {};
    for (let hour = day.start; hour < day.end; hour++) {
      for (const skill of day.skills) {
        const key = `${hour}-${skill}`;
        if (!skillHourNeeds[key]) {
          skillHourNeeds[key] = { hour, skill, coverage: 0, assigned: [] };
        }
      }
    }

    // Get available employees sorted by effectiveness
    const candidates = this.employees
      .map((emp, idx) => {
        if (emp.vacationSet.has(dayIdx)) return null;
        
        const state = this.employeeStates[idx];
        const weekHours = state.hoursThisWeek[dayIdx];
        const isOvertime = weekHours >= emp.maxHours;
        const hourlyCost = isOvertime 
          ? Math.floor(emp.salary * this.overtimeModifier / 100)
          : emp.salary;
        
        return { emp, empIdx: idx, state, weekHours, hourlyCost };
      })
      .filter(c => c !== null);

    // Assign employees to cover skill-hours
    const hoursNeeded = day.end - day.start;
    
    // Group skills to assign efficiently
    const uniqueSkills = [...new Set(day.skills)];
    
    for (const skill of uniqueSkills) {
      const skillCount = day.skills.filter(s => s === skill).length;
      
      // Sort candidates: skilled first, then by cost
      const sorted = candidates
        .map(c => ({
          ...c,
          hasSkill: c.state.skills.has(skill),
          effectiveHours: Math.min(hoursNeeded, 40 - c.weekHours) // reasonable limit
        }))
        .filter(c => c.effectiveHours > 0)
        .sort((a, b) => {
          if (a.hasSkill !== b.hasSkill) return b.hasSkill - a.hasSkill;
          return a.hourlyCost - b.hourlyCost;
        });

      // Assign enough employees to cover this skill
      let needsCoverage = skillCount;
      for (const candidate of sorted) {
        if (needsCoverage <= 0) break;
        
        const assignHours = Math.min(hoursNeeded, candidate.effectiveHours);
        if (assignHours > 0) {
          shifts.push({
            empId: candidate.emp.id,
            empIdx: candidate.empIdx,
            start: day.start,
            end: day.start + assignHours,
            skill: skill
          });
          
          // Update coverage
          const coverageAmount = candidate.hasSkill ? 1 : 0.5;
          needsCoverage -= coverageAmount;
          
          // Track hours used
          candidate.weekHours += assignHours;
          candidate.effectiveHours -= assignHours;
        }
      }
    }

    return shifts;
  }

  applyShifts(dayIdx, shifts) {
    const weekStart = Math.floor(dayIdx / 7) * 7;
    
    // Calculate hours worked by each employee
    const empHours = new Map();
    for (const shift of shifts) {
      const hours = shift.end - shift.start;
      empHours.set(shift.empIdx, (empHours.get(shift.empIdx) || 0) + hours);
    }
    
    // Update states
    for (const shift of shifts) {
      const state = this.employeeStates[shift.empIdx];
      const emp = this.employees[shift.empIdx];
      const hours = shift.end - shift.start;
      
      // Update weekly hours for all future days in this week
      for (let d = dayIdx; d < Math.min(this.days.length, weekStart + 7); d++) {
        state.hoursThisWeek[d] += hours;
      }
      
      // Handle training
      if (!state.skills.has(shift.skill)) {
        // Check if there's a teacher
        const hasTeacher = shifts.some(s => 
          s.skill === shift.skill && 
          s.empIdx !== shift.empIdx &&
          this.employeeStates[s.empIdx].skills.has(shift.skill) &&
          s.start === shift.start && 
          s.end === shift.end
        );
        
        const teacherRate = hasTeacher 
          ? Math.max(...shifts
              .filter(s => s.skill === shift.skill && s.empIdx !== shift.empIdx)
              .map(s => this.employees[s.empIdx].teachingRate))
          : 1;
        
        const points = hours * emp.learningRate * teacherRate;
        state.trainingProgress[shift.skill] = (state.trainingProgress[shift.skill] || 0) + points;
        
        if (state.trainingProgress[shift.skill] >= 1000) {
          state.skills.add(shift.skill);
        }
      }
    }
  }

  writeOutput(filename) {
    const lines = [];
    
    for (let i = 0; i < this.days.length; i++) {
      const day = this.days[i];
      const shifts = this.schedule[i];
      
      if (shifts.length === 0) {
        lines.push(`${day.id} _`);
      } else {
        const tokens = shifts.map(s => `${s.empId}-${s.start}-${s.end}-${s.skill}`);
        lines.push(`${day.id} ${tokens.join(' ')}`);
      }
    }
    
    fs.writeFileSync(filename, lines.join('\n') + '\n');
  }
}

// Main execution
if (require.main === module) {
  const inputFile = process.argv[2] || 'examples/b_week.txt';
  const outputFile = process.argv[3] || 'output.txt';

  console.log('Parsing input...');
  const scheduler = new Scheduler();
  scheduler.parseInput(inputFile);

  console.log(`Loaded ${scheduler.days.length} days and ${scheduler.employees.length} employees`);
  console.log('Generating schedule...');
  
  scheduler.generateSchedule();
  
  console.log('Writing output...');
  scheduler.writeOutput(outputFile);
  
  console.log(`Schedule written to ${outputFile}`);
}

module.exports = Scheduler;