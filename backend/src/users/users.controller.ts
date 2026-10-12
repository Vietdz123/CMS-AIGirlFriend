import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { UsersService } from './users.service';

class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  name: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsEnum(Role)
  role: Role;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  appIds?: string[];
}

class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  active?: boolean;
}

class SetAppsDto {
  @IsArray()
  @IsString({ each: true })
  appIds: string[];
}

@Roles(Role.ADMIN)
@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  update(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    if (id === me.id && ((dto.role && dto.role !== Role.ADMIN) || dto.active === false)) {
      throw new BadRequestException('Không thể tự hạ quyền hoặc khoá chính mình');
    }
    return this.users.update(id, dto);
  }

  @Put(':id/apps')
  setApps(@Param('id') id: string, @Body() dto: SetAppsDto) {
    return this.users.setApps(id, dto.appIds);
  }

  @Delete(':id')
  async remove(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    if (id === me.id) throw new BadRequestException('Không thể xoá chính mình');
    await this.users.remove(id);
    return { ok: true };
  }
}
