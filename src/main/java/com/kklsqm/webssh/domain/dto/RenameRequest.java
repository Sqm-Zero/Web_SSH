package com.kklsqm.webssh.domain.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 功能: 文件重命名请求
 * 作者: 沙琪马
 * 日期: 2025/8/22 16:00
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class RenameRequest {
    private String oldPath;
    private String newPath;
}
