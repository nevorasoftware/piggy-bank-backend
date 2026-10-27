import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { ENV } from '../config/env';
import { validateDUI } from '../utils/dui.validator';
import { WhatsAppService } from '../services/whatsapp.service';
import { AuthRequest } from '../middlewares/auth.middleware';
import { VerificationType, Role } from '@prisma/client';

export class AuthController {
  /**
   * Registro de nuevo usuario con validación estricta de DUI salvadoreño.
   */
  public static async register(req: Request, res: Response): Promise<void> {
    try {
      const { fullName, email, phone, dui, password } = req.body;

      if (!fullName || !email || !phone || !dui || !password) {
        res.status(400).json({
          success: false,
          message: 'Todos los campos son obligatorios: Nombre completo, correo, teléfono, DUI y contraseña.',
        });
        return;
      }

      // Validar formato y dígito verificador del DUI
      const duiCheck = validateDUI(dui);
      if (!duiCheck.isValid) {
        res.status(400).json({
          success: false,
          message: duiCheck.message,
        });
        return;
      }

      // Comprobar si el usuario, correo, teléfono o DUI ya existen
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [{ email }, { phone }, { dui }],
        },
      });

      if (existingUser) {
        if (existingUser.email === email) {
          res.status(409).json({ success: false, message: 'El correo electrónico ya está registrado.' });
          return;
        }
        if (existingUser.phone === phone) {
          res.status(409).json({ success: false, message: 'El número de teléfono ya está registrado.' });
          return;
        }
        if (existingUser.dui === dui) {
          res.status(409).json({ success: false, message: 'El DUI ingresado ya está registrado.' });
          return;
        }
      }

      // Hashear contraseña
      const hashedPassword = await bcrypt.hash(password, 10);

      // Crear usuario (Por defecto siempre jugadores)
      const newUser = await prisma.user.create({
        data: {
          fullName,
          email,
          phone,
          dui,
          password: hashedPassword,
          role: Role.USER,
        },
      });

      // Generar código OTP de 6 dígitos para WhatsApp
      const otpCode = crypto.randomInt(100000, 999999).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutos

      await prisma.verificationCode.create({
        data: {
          userId: newUser.id,
          identifier: newUser.phone,
          type: VerificationType.WHATSAPP,
          code: otpCode,
          expiresAt,
        },
      });

      // Enviar OTP vía WhatsApp Cloud API
      await WhatsAppService.sendOtpCode(newUser.phone, otpCode);

      // Generar JWT provisional
      const token = jwt.sign(
        { id: newUser.id, email: newUser.email, role: newUser.role },
        ENV.JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.status(201).json({
        success: true,
        message: 'Usuario registrado exitosamente. Se ha enviado un código de verificación a tu WhatsApp.',
        token,
        user: {
          id: newUser.id,
          fullName: newUser.fullName,
          email: newUser.email,
          phone: newUser.phone,
          dui: newUser.dui,
          role: newUser.role,
          phoneVerified: newUser.phoneVerified,
        },
      });
    } catch (error: any) {
      console.error('Error en register:', error);
      res.status(500).json({ success: false, message: 'Error interno en el servidor.' });
    }
  }

  /**
   * Verificación de código OTP
   */
  public static async verifyOtp(req: Request, res: Response): Promise<void> {
    try {
      const { identifier, code } = req.body;

      if (!identifier || !code) {
        res.status(400).json({ success: false, message: 'Se requiere identificador (teléfono o correo) y código OTP.' });
        return;
      }

      const record = await prisma.verificationCode.findFirst({
        where: {
          identifier,
          code,
          used: false,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!record) {
        res.status(400).json({ success: false, message: 'Código OTP inválido o expirado.' });
        return;
      }

      // Marcar código como usado
      await prisma.verificationCode.update({
        where: { id: record.id },
        data: { used: true },
      });

      // Actualizar estado de verificación del usuario
      if (record.userId) {
        await prisma.user.update({
          where: { id: record.userId },
          data: {
            phoneVerified: record.type === VerificationType.WHATSAPP ? true : undefined,
            emailVerified: record.type === VerificationType.EMAIL ? true : undefined,
          },
        });
      }

      res.json({ success: true, message: 'Verificación exitosa.' });
    } catch (error) {
      console.error('Error en verifyOtp:', error);
      res.status(500).json({ success: false, message: 'Error interno al verificar OTP.' });
    }
  }

  /**
   * Inicio de Sesión
   */
  public static async login(req: Request, res: Response): Promise<void> {
    try {
      const { identifier, password } = req.body; // Puede ser correo o DUI o teléfono

      if (!identifier || !password) {
        res.status(400).json({ success: false, message: 'Credenciales incompletas.' });
        return;
      }

      const user = await prisma.user.findFirst({
        where: {
          OR: [{ email: identifier }, { phone: identifier }, { dui: identifier }],
        },
        include: { bankAccount: true },
      });

      if (!user) {
        res.status(401).json({ success: false, message: 'Credenciales incorrectas.' });
        return;
      }

      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        res.status(401).json({ success: false, message: 'Credenciales incorrectas.' });
        return;
      }

      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        ENV.JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.json({
        success: true,
        message: 'Sesión iniciada correctamente.',
        token,
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          phone: user.phone,
          dui: user.dui,
          role: user.role,
          phoneVerified: user.phoneVerified,
          emailVerified: user.emailVerified,
          bankAccount: user.bankAccount,
        },
      });
    } catch (error) {
      console.error('Error en login:', error);
      res.status(500).json({ success: false, message: 'Error interno al iniciar sesión.' });
    }
  }

  /**
   * Obtener perfil del usuario autenticado
   */
  public static async me(req: AuthRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'No autenticado.' });
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: {
          bankAccount: true,
          dailyStats: {
            orderBy: { fecha: 'desc' },
            take: 1,
          },
        },
      });

      if (!user) {
        res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
        return;
      }

      res.json({
        success: true,
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          phone: user.phone,
          dui: user.dui,
          role: user.role,
          phoneVerified: user.phoneVerified,
          emailVerified: user.emailVerified,
          bankAccount: user.bankAccount,
          todayStats: user.dailyStats[0] || null,
        },
      });
    } catch (error) {
      console.error('Error en me:', error);
      res.status(500).json({ success: false, message: 'Error interno en perfil.' });
    }
  }
}
