import fs from "node:fs";

function parseInput(filename) {
  const content = fs.readFileSync(filename, "utf8");
  const lines = content.split(/\r?\n/).filter(Boolean);

  let idx = 0;

  const [overtimeModifier, fixedDailyCost] = lines[idx++].split(" ").map(Number);

  const numDays = Number(lines[idx++]);
  const days = [];
  for (let i = 0; i < numDays; i++) {
    const parts = lines[idx++].split(" ");
    const dayId = Number(parts[0]);

    if (parts.length === 1) {
      days.push({ id: dayId, closed: true });
    } else {
      const start = Number(parts[1]);
      const end = Number(parts[2]);
      const revenue = Number(parts[3]);
      const skills = parts[4].split(",");
      days.push({ id: dayId, closed: false, start, end, revenue, skills });
    }
  }

  const employees = [];
  while (idx < lines.length) {
    const parts = lines[idx++].split(" ");
    const id = Number(parts[0]);
    const maxHoursPerWeek = Number(parts[1]);
    const salaryPerHour = Number(parts[2]);
    const learningRate = Number(parts[3]);
    const teachingRate = Number(parts[4]);
    const skills = parts[5] === "_" ? [] : parts[5].split(",");
    const vacation = parts[6] === "_" ? [] : parts[6].split(",").map(Number);

    employees.push({
      id,
      maxHoursPerWeek,
      salaryPerHour,
      learningRate,
      teachingRate,
      skills: new Set(skills),
      vacation: new Set(vacation),
      trainedSkills: new Set(skills),
      trainingProgress: {},
    });
  };

  return { overtimeModifier, fixedDailyCost, days, employees };
};

function advancedSchedule(input) {
  const { days, employees, overtimeModifier, fixedDailyCost } = input;
  
  const schedule = [];
  const weeklyHours = new Map();
  const employeeSkills = new Map();
  
  // Initialize tracking
  for (const emp of employees) {
    employeeSkills.set(emp.id, {
      trained: new Set(emp.skills),
      progress: {}
    });
  }
  
  for (const day of days) {
    if (day.closed) {
      schedule.push({ dayId: day.id, shifts: [] });
      continue;
    }
    
    const shiftHours = day.end - day.start;
    const shifts = [];
    const skillAssignments = new Map();
    
    // Multi-pass assignment: assign trained employees first, then untrained with teachers
    for (const skill of day.skills) {
      const candidates = [];
      
      for (const emp of employees) {
        if (emp.vacation.has(day.id)) continue;
        
        const weekStart = Math.floor(day.id / 7) * 7;
        const hoursThisWeek = weeklyHours.get(`${weekStart}-${emp.id}`) || 0;
        
        const overtimeHours = Math.max(0, hoursThisWeek + shiftHours - emp.maxHoursPerWeek);
        const baseHours = shiftHours - overtimeHours;
        
        const cost = baseHours * emp.salaryPerHour +
          overtimeHours * Math.floor((emp.salaryPerHour * overtimeModifier) / 100);
        
        const empSkills = employeeSkills.get(emp.id);
        const isTrained = empSkills.trained.has(skill);
        
        // Heavy preference for trained, minimize overtime
        const score = (isTrained ? 1000000 : 100) - cost - (overtimeHours * 5000);
        
        candidates.push({ emp, score, cost, isTrained, overtimeHours });
      }
      
      candidates.sort((a, b) => b.score - a.score);
      
      // Take best candidate
      if (candidates.length > 0) {
        const best = candidates[0];
        
        shifts.push({
          employeeId: best.emp.id,
          start: day.start,
          end: day.end,
          skill: skill,
        });
        
        const weekStart = Math.floor(day.id / 7) * 7;
        const key = `${weekStart}-${best.emp.id}`;
        weeklyHours.set(key, (weeklyHours.get(key) || 0) + shiftHours);
        
        if (!skillAssignments.has(skill)) {
          skillAssignments.set(skill, []);
        }
        skillAssignments.set(skill, best);
      }
    }
    
    // Process training gains
    for (const shift of shifts) {
      const empSkills = employeeSkills.get(shift.employeeId);
      if (!empSkills.trained.has(shift.skill)) {
        const emp = employees.find(e => e.id === shift.employeeId);
        
        // Check for teacher
        let teachingRate = 1;
        for (const otherShift of shifts) {
          if (otherShift.skill === shift.skill && otherShift.employeeId !== shift.employeeId) {
            const otherEmpSkills = employeeSkills.get(otherShift.employeeId);
            if (otherEmpSkills.trained.has(shift.skill)) {
              const teacher = employees.find(e => e.id === otherShift.employeeId);
              teachingRate = Math.max(teachingRate, teacher.teachingRate);
            }
          }
        }
        
        const progress = empSkills.progress[shift.skill] || 0;
        const gain = shiftHours * emp.learningRate * teachingRate;
        empSkills.progress[shift.skill] = progress + gain;
        
        if (empSkills.progress[shift.skill] >= 1000) {
          empSkills.trained.add(shift.skill);
        }
      }
    }
    
    schedule.push({ dayId: day.id, shifts });
  }
  
  return schedule;
}

function calculateScore(input, schedule) {
  const { days, employees, overtimeModifier, fixedDailyCost } = input;
  let totalScore = 0;
  const weeklyHours = new Map();

  for (let i = 0; i < schedule.length; i++) {
    const day = days[i];
    const daySchedule = schedule[i];

    if (day.closed) {
      totalScore -= fixedDailyCost;
      continue;
    }

    const requiredSkillHours = (day.end - day.start) * day.skills.length;
    let coveredSkillHours = 0;

    for (const skill of day.skills) {
      for (let hour = day.start; hour < day.end; hour++) {
        const workersOnSkill = daySchedule.shifts.filter(
          (s) => s.skill === skill && s.start <= hour && s.end > hour
        );

        let hourCoverage = 0;
        for (const shift of workersOnSkill) {
          const emp = employees.find((e) => e.id === shift.employeeId);
          const isTrained = emp.trainedSkills.has(skill);
          hourCoverage += isTrained ? 1 : 0.5;
        }
        coveredSkillHours += Math.min(1, hourCoverage);
      }
    }

    const capacityPercent = coveredSkillHours / requiredSkillHours;
    const revenue = day.revenue * capacityPercent ** 2;

    let payroll = 0;

    for (const shift of daySchedule.shifts) {
      const emp = employees.find((e) => e.id === shift.employeeId);
      const shiftHours = shift.end - shift.start;

      const weekStart = Math.floor(day.id / 7) * 7;
      const key = `${weekStart}-${emp.id}`;
      const hoursBeforeThisShift = weeklyHours.get(key) || 0;

      let baseHours = Math.min(shiftHours, emp.maxHoursPerWeek - hoursBeforeThisShift);
      baseHours = Math.max(0, baseHours);
      const overtimeHours = shiftHours - baseHours;

      const cost = baseHours * emp.salaryPerHour +
        overtimeHours * Math.floor((emp.salaryPerHour * overtimeModifier) / 100);

      payroll += cost;
      weeklyHours.set(key, hoursBeforeThisShift + shiftHours);
    }

    const profit = revenue - payroll - fixedDailyCost;
    totalScore += profit;
  }

  return totalScore;
}

function formatOutput(schedule) {
  const lines = [];

  for (const day of schedule) {
    if (day.shifts.length === 0) {
      lines.push(`${day.dayId} _`);
    } else {
      const tokens = day.shifts
        .map((s) => `${s.employeeId}-${s.start}-${s.end}-${s.skill}`)
        .join(" ");
      lines.push(`${day.dayId} ${tokens}`);
    }
  }

  return lines.join("\n");
}

// Main
const inputFile = process.argv[2] || "A_Example.txt";
const outputFile = inputFile.replace(".txt", "_solution.txt");

const input = parseInput(inputFile);
const schedule = advancedSchedule(input);
const output = formatOutput(schedule);

fs.writeFileSync(outputFile, output);

const totalScore = calculateScore(input, schedule);
console.log(totalScore.toFixed(2));
