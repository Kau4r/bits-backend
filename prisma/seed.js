const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
    const hash = async (pw) => bcrypt.hash(pw, 10);

    await prisma.user.createMany({
        data: [
            {
                Username: 'admin',
                User_Role: 'ADMIN',
                First_Name: 'Admin',
                Middle_Name: '',
                Last_Name: 'User',
                Email: 'admin@bits.edu',
                Password: await hash('admin123'),
                Is_Active: true
            },
            {
                Username: 'labtech',
                User_Role: 'LAB_TECH',
                First_Name: 'Lab',
                Middle_Name: '',
                Last_Name: 'Technician',
                Email: 'labtech@bits.edu',
                Password: await hash('labtech123'),
                Is_Active: true
            },
            {
                Username: 'labhead',
                User_Role: 'LAB_HEAD',
                First_Name: 'Lab',
                Middle_Name: '',
                Last_Name: 'Head',
                Email: 'labhead@bits.edu',
                Password: await hash('labhead123'),
                Is_Active: true
            },
            {
                Username: 'faculty',
                User_Role: 'FACULTY',
                First_Name: 'Faculty',
                Middle_Name: '',
                Last_Name: 'Member',
                Email: 'faculty@bits.edu',
                Password: await hash('faculty123'),
                Is_Active: true
            },
            {
                Username: 'secretary',
                User_Role: 'SECRETARY',
                First_Name: 'Secretary',
                Middle_Name: '',
                Last_Name: 'User',
                Email: 'secretary@bits.edu',
                Password: await hash('secretary123'),
                Is_Active: true
            },
            {
                Username: 'student',
                User_Role: 'STUDENT',
                First_Name: 'Student',
                Middle_Name: '',
                Last_Name: 'User',
                Email: 'student@bits.edu',
                Password: await hash('student123'),
                Is_Active: true
            }
        ],
        skipDuplicates: true
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
