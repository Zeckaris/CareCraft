import { Response } from "express";

interface Pagination {
  total: number;
  page: number;
  limit: number;
}

export const sendResponse = (
  res: Response,
  statusCode: number,
  success: boolean,
  message: string,
  data: any = null,
  error: any = null,
  pagination?: Pagination
): Response => {
  const response: Record<string, any> = {
    success,
    message,
    data,
    error,
  };

  if (pagination) {
    response.pagination = {
      total: pagination.total,
      page: pagination.page,
      limit: pagination.limit,
    };
  }

  return res.status(statusCode).json(response);
};
