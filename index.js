import fs from 'node:fs';
const inputAsString = fs.readFileSync('examples/F_Decade.txt', 'utf8');

const lines = inputAsString.split('\n');
const overtimeModifierPercent = parseInt(lines[0].split(' ')[0]);
const fixedDailyCost = parseInt(lines[0].split(' ')[1]);

const numberOfDays = parseInt(lines[1]);

// REGION: Input Parsing
function dayParser(line) {
  return {
    isClosed: false,
    dayId: parseInt(line[0]),
    start: parseInt(line[1]),
    end: parseInt(line[2]),
    dailyRevenue: parseInt(line[3]),
    requiredSkills: line[4].split(','),
  };
};
function employeeParser(line) {
  return {
    employeeId: parseInt(line[0]),
    maxHoursPerWeek: parseInt(line[1]),
    salaryPerHour: parseInt(line[2]),
    learningRate: parseInt(line[3]),
    teachingRate: parseInt(line[4]),
    skills: line[5].split(','),
    vacationDays: line[6] === '_' ? [] : line[6].split(','),
  };
};

const openDays = [];
const closedDays = [];
const employees = [];
const allDays = [];

for (const line of lines.slice(2)) {
  const lineData = line.split(' ');

  if (lineData.length === 0 || lineData[0] === '') continue; // skip empty lines

  const isClosedDay = lineData.length === 1;
  const isOpenDay = lineData.length === 5;
  const isEmployee = lineData.length === 7;

  if (isOpenDay) {
    openDays.push(dayParser(lineData));
    allDays.push(dayParser(lineData));
  } else if (isClosedDay) {
    closedDays.push(parseInt(lineData[0]));
    allDays.push({ dayId: parseInt(lineData[0]), isClosed: true });
  } else if (isEmployee) {
    employees.push(employeeParser(lineData));
  };
};

// openDays.sort((a, b) => a.dayId - b.dayId); // sorts from low to high
// ENDREGION: Input Parsing





// schedule parser 
const employeeWorkHoursDict={} // key = employeeId , value = array with number of hours per day
const schedule = [];
function scheduleParser(line) {
  const parts = line.trim().split(/\s+/);
  if (parts.length === 0) return;
  const dayId = parseInt(parts[0]);
  const isClosedDay = parts[1] === '_';
  const dayInfo = openDays.find(d => d.dayId === dayId);
   if (isClosedDay) {
    if (parts.length > 2) return; 
    const dayData = { dayId, shifts: [] };
    schedule.push(dayData);
    return dayData;
  }

  if (!dayInfo) return; 

   const shifts = parts.slice(1).map(token => {
    const [employeeId, start, end, skill] = token.split('-');
    const startHour = parseInt(start);
    const endHour = parseInt(end);

    if ( !Object.hasOwn(employeeWorkHoursDict, employeeId) ) {
        employeeWorkHoursDict[employeeId] = [];
    }
    employeeWorkHoursDict[employeeId].add(endHour-startHour);
    
    return {
      employeeId: parseInt(employeeId),
      start: startHour,
      end: endHour,
      skill,
    };
  });
  // --- Validatie: start < end en integers + binnen openingsuren ---
  for (const s of shifts) {
    if (!Number.isInteger(s.start) || !Number.isInteger(s.end)) return;
    if (s.start >= s.end) return;
    if (s.start < dayInfo.start || s.end > dayInfo.end) return;
  }
  // --- Validatie: geen overlap per werknemer ---
  const grouped = {};
  for (const s of shifts) {
    if (!grouped[s.employeeId]) grouped[s.employeeId] = [];
    grouped[s.employeeId].push(s);
  }

  for (const empShifts of Object.values(grouped)) {
    empShifts.sort((a, b) => a.start - b.start);
    for (let i = 0; i < empShifts.length - 1; i++) {
      const curr = empShifts[i];
      const next = empShifts[i + 1];
      if (next.start < curr.end) return; 
    }
  }

  const dayData = { dayId, shifts };
  schedule.push(dayData);
  return dayData;
}


// calculate daycapacity en Training & Skill Acquisition

const hours = [];
function calculateDayCapacity(dayData) {
  const dayInfo = openDays.find(d => d.dayId === dayData.dayId);
  if (!dayInfo || dayData.shifts.length === 0) return 0; // geen open dag of geen shifts
  for (let h = dayInfo.start; h < dayInfo.end; h++) hours.push(h);

  let totalSkillHours = hours.length * dayInfo.requiredSkills.length;
  let coveredSkillHours = 0;
  for (const skill of dayInfo.requiredSkills) {
    for (const hour of hours) {
      let coverage = 0;

      // Alle shifts die op dit skill en uur vallen
      const shiftsThisHour = dayData.shifts.filter(
        s => s.skill === skill && hour >= s.start && hour < s.end
      );

      // Bepaal teachers (minstens 1 trained employee op dit skill)
      const teachers = shiftsThisHour
        .map(s => employees.find(e => e.employeeId === s.employeeId))
        .filter(e => e.trainedSkills?.has(skill));

      const maxTeachingRate = teachers.length > 0 ? Math.max(...teachers.map(t => t.teachingRate)) : 1;

      for (const shift of shiftsThisHour) {
        const emp = employees.find(e => e.employeeId === shift.employeeId);
        if (!emp) continue;

        if (emp.trainedSkills?.has(skill)) {
          coverage = 1; // full coverage
        } else {
          coverage += 0.5; // halve coverage

          // Training points bijwerken aan het einde van het uur
          emp.trainingPoints = emp.trainingPoints || {};
          emp.trainingPoints[skill] = (emp.trainingPoints[skill] || 0) + emp.learningRate * maxTeachingRate;

          // Check of werknemer nu getraind wordt
          if (emp.trainingPoints[skill] >= 1000) {
            emp.trainedSkills = emp.trainedSkills || new Set();
            emp.trainedSkills.add(skill); // vanaf volgende uur full coverage
          }
        }
      }

      if (coverage > 1) coverage = 1;
      coveredSkillHours += coverage;
    }
  }

  const capacityPercent = (coveredSkillHours / totalSkillHours) * 100;
  return capacityPercent;
}















//10. payroll & overtime
function calculateOvertimeHours(employee){
    const maxHoursPerWeek = employee[maxHoursPerWeek];
    const employeeDaysWorkedArray = employeeWorkHoursDict[employee[employeeId]];
    const numberOfDaysWorked = employeeDaysWorkedArray.length;
    const numberOfWeeksWorked = Math.trunc(numberOfDaysWorked/7);
    const remainderDays = numberOfDaysWorked % 7;

    let overtimeHours = 0;
    for (let week=0; week<numberOfWeeksWorked; week++){
        let hoursPerWeek = 0;
        for (let day=0; day<7; day++){
            const hoursPerDay = employeeDaysWorkedArray[(week*7)+day];
            hoursPerWeek += hoursPerDay;
        }
        if (hoursPerWeek > maxHoursPerWeek) {
            overtimeHours += hoursPerWeek - maxHoursPerWeek;
        }
    }

    let extraDaysWorkHours = 0;
    for (let day=0; day<remainderDays; day++){
        extraDaysWorkHours += employeeDaysWorkedArray[(numberOfWeeksWorked*7) + day];
    }
    if (extraDaysWorkHours > maxHoursPerWeek) {
        overtimeHours += extraDaysWorkHours-maxHoursPerWeek;
    }
    return overtimeHours;
}

function calculateWeeklyPayroll(employee) {
    const overtimeHours = calculateOvertimeHours(employee);
    const overtime_cost = floor(employee.salaryPerHour * overtimeModifierPercent / 100)
}





fs.writeFileSync('output.txt', "a");

function calcScore() {

  const profit_day = revenue_day * (capacity_percent)^2 - payroll_costs_day - fixed_daily_cost;
  return profit_day;
};
