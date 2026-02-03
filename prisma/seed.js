const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const User = await prisma.user.findMany(); // correct
    await prisma.user.createMany({
        data: [
            {
                User_Role: 'ADMIN',
                First_Name: 'Admin',
                Middle_Name: '',
                Last_Name: 'User',
                Email: 'admin@bits.edu',
                Password: 'admin123',
                Is_Active: true
            }, {
                User_Role: 'LAB_TECH',
                First_Name: 'Lab',
                Middle_Name: '',
                Last_Name: 'Technician',
                Email: 'labtech@bits.edu',
                Password: 'labtech123',
                Is_Active: true,
            },
            {
                User_Role: 'LAB_HEAD',
                First_Name: 'Lab',
                Middle_Name: '',
                Last_Name: 'Head',
                Email: 'labhead@bits.edu',
                Is_Active: true,
                Password: 'labhead123'
            },
            {
                User_Role: 'FACULTY',
                First_Name: 'Faculty',
                Middle_Name: '',
                Last_Name: 'Member',
                Email: 'faculty@bits.edu',
                Is_Active: true,
                Password: 'faculty123'
            },
            {
                User_Role: 'SECRETARY',
                First_Name: 'Secretary',
                Middle_Name: '',
                Last_Name: 'User',
                Email: 'secretary@bits.edu',
                Is_Active: true,
                Password: 'secretary123'
            },
            {
                User_Role: 'STUDENT',
                First_Name: 'Student',
                Middle_Name: '',
                Last_Name: 'User',
                Email: 'student@bits.edu',
                Is_Active: true,
                Password: 'student123'
            }
        ],
        skipDuplicates: true // prevents duplicate inserts on re-run
    });
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
