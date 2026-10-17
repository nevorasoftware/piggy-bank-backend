import { PrismaClient, Role, RoomStatus, AccountType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed de la base de datos PiggyBank...');

  // 1. Configuración de Juego (Reglas 6/3)
  const gameConfig = await prisma.gameConfig.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      maxParticipacionesDia: 6,
      maxVictoriasDia: 3,
    },
  });
  console.log('✅ GameConfig configurado:', gameConfig);

  // 2. Administrador del Sistema
  const hashedPassword = await bcrypt.hash('AdminPiggy2026!', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@piggybank.sv' },
    update: {},
    create: {
      fullName: 'Administrador PiggyBank',
      email: 'admin@piggybank.sv',
      phone: '+50370001122',
      dui: '01234567-8',
      password: hashedPassword,
      role: Role.ADMIN,
      emailVerified: true,
      phoneVerified: true,
    },
  });
  console.log('✅ Admin creado:', admin.email);

  // 3. Usuario de Prueba
  const userPassword = await bcrypt.hash('Jugador2026!', 10);
  const user = await prisma.user.upsert({
    where: { email: 'jugador@ejemplo.com' },
    update: {},
    create: {
      fullName: 'Carlos Ernesto Rivas Mendoza',
      email: 'jugador@ejemplo.com',
      phone: '+50378901234',
      dui: '02345678-9',
      password: userPassword,
      role: Role.USER,
      emailVerified: true,
      phoneVerified: true,
      bankAccount: {
        create: {
          bankName: 'Banco Agrícola El Salvador',
          accountType: AccountType.AHORRO,
          accountNumber: '540-00123456-7',
          accountHolder: 'Carlos Ernesto Rivas Mendoza',
        },
      },
    },
  });
  console.log('✅ Usuario demo creado:', user.email);

  // 4. Salas de Sorteo Iniciales
  const now = new Date();
  const room1Draw = new Date(now.getTime() + 45 * 60 * 1000); // En 45 mins
  const room2Draw = new Date(now.getTime() + 120 * 60 * 1000); // En 2 horas
  const room3Draw = new Date(now.getTime() + 360 * 60 * 1000); // En 6 horas

  const existingRooms = await prisma.room.count();
  if (existingRooms === 0) {
    await prisma.room.createMany({
      data: [
        {
          nombre: 'Cerdito Express $50',
          premio: 50.0,
          costoPase: 2.5,
          capacidadMax: 25,
          horaApertura: now,
          horaSorteo: room1Draw,
          estado: RoomStatus.ABIERTA,
          ticketsSold: 8,
        },
        {
          nombre: 'Chanchito Dorado $250',
          premio: 250.0,
          costoPase: 5.0,
          capacidadMax: 60,
          horaApertura: now,
          horaSorteo: room2Draw,
          estado: RoomStatus.ABIERTA,
          ticketsSold: 19,
        },
        {
          nombre: 'Gran Alcancía Millonaria $1,000',
          premio: 1000.0,
          costoPase: 15.0,
          capacidadMax: 100,
          horaApertura: now,
          horaSorteo: room3Draw,
          estado: RoomStatus.ABIERTA,
          ticketsSold: 42,
        },
      ],
    });
    console.log('✅ Salas iniciales de sorteo creadas.');
  }

  console.log('🏁 Seed completado con éxito.');
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
