/**
 * Mock user objects for testing
 */
const testUsers = {
  admin: {
    User_ID: 9999,
    Email: 'admin@test.com',
    First_Name: 'Test',
    Last_Name: 'Admin',
    User_Role: 'ADMIN',
    Is_Active: true,
  },
  labTech: {
    User_ID: 9998,
    Email: 'labtech@test.com',
    First_Name: 'Test',
    Last_Name: 'LabTech',
    User_Role: 'LAB_TECH',
    Is_Active: true,
  },
  student: {
    User_ID: 9997,
    Email: 'student@test.com',
    First_Name: 'Test',
    Last_Name: 'Student',
    User_Role: 'STUDENT',
    Is_Active: true,
  },
  faculty: {
    User_ID: 9996,
    Email: 'faculty@test.com',
    First_Name: 'Test',
    Last_Name: 'Faculty',
    User_Role: 'FACULTY',
    Is_Active: true,
  },
};

module.exports = { testUsers };
