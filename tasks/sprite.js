var 
spritesmith = require('spritesmith'),
async = require('async'),
path = require('path');

module.exports = function (grunt) {
	"use strict";

	var SLICE_PLACE = '{{$slice_{id}$}}';
	var R_SLICE_PLACE = /\{\{\$slice_(\d+)\$\}\}/g;

	function fixPath(path) {
		return String(path).replace(/\\/g, '/').replace(/\/$/, '');
	}

	function getSliceData(src, slicePath) {
		var 
		cssPath = path.dirname(src),
		cssData = grunt.file.read(src),
		rabsUrl = /^(\/|https?:|file:)/i,
		rbgs = /background(?:-image)?\s*:[^;]*?url\((["\']?)([^\)]+)\1\)[^};]*;?/ig;

		var cssList = [], cssHash = {}, cssInx = 0;
		var imgList = [], imgHash = {}, imgInx = 0;

		slicePath = fixPath(slicePath);

		cssData = cssData.replace(rbgs, function(css, b, uri) {
			if(rabsUrl.test(uri)) {
				return css;
			}

			var 
			imgFullPath = fixPath(path.join(cssPath, uri)),
			imgPath = path.basename(imgFullPath);

			if(!imgHash[imgFullPath] && !grunt.file.exists(imgFullPath)) {
				return css;
			}

			var currCssInx = cssHash[css];
			if(currCssInx == null) {
				currCssInx = cssHash[css] = cssInx;

				cssList[cssInx++] = {
					imgFullPath: imgFullPath,
					imgPath: uri,
					css: css
				};
			}

			if(!imgHash[imgFullPath]) {
				imgList[imgInx++] = imgFullPath;
				imgHash[imgFullPath] = true;
			}

			return SLICE_PLACE.replace('{id}', currCssInx);
		});

		return {
			cssData: cssData,
			cssList: cssList,
			cssHash: cssHash,
			imgList: imgList,
			imgHash: imgHash
		};
	}

	function createSprite(list, options, callback) {
        spritesmith({
            algorithm: options.algorithm,
            padding: options.padding,
            engine: options.engine,
            src: list
        }, function(err, ret) {
            if(err) {
                return callback(err);
            }

            callback(null, ret);
        });
    }


	grunt.registerMultiTask('sprite', 'Create sprite image with slices and update the CSS file.', function () {
		var done = this.async();

		var options = this.options({
			// sprite背景图源文件夹，只有匹配此路径才会处理，默认 images/slice/
			imagepath: 'images/slice/',
			// 雪碧图输出目录，注意，会覆盖之前文件！默认 images/
			spritedest: 'images/',
			// 替换后的背景路径，默认 ../images/
			spritepath: '../images/',
			// 各图片间间距，如果设置为奇数，会强制+1以保证生成的2x图片为偶数宽高，默认 0
			padding: 0,
			// 是否使用 image-set 作为2x图片实现，默认不使用
			useimageset: false,
			// 是否以时间戳为文件名生成新的雪碧图文件，如果启用请注意清理之前生成的文件，默认不生成新文件
			newsprite: false,
			// 给雪碧图追加时间戳，默认不追加
			spritestamp: false,
			// 在CSS文件末尾追加时间戳，默认不追加
			cssstamp: false,
			// 默认使用二叉树最优排列算法
			algorithm: 'binary-tree',
			// 默认使用`pngsmith`图像处理引擎
			engine: 'pngsmith'
		});

		// `padding` must be even
		if(options.padding % 2 !== 0){
			options.padding += 1;
		}

		async.each(this.files, function(file, callback) {
			var 
			src = file.src[0],
			cssDest = file.dest,
			sliceData = getSliceData(src, options.imagepath),
			cssList = sliceData.cssList;

			if(!cssList || cssList.length <= 0) {
				grunt.file.copy(src, cssDest);
                grunt.log.writelns(('Done! [Copied] -> ' + cssDest));
                return callback(null);
			}

			async.waterfall([
				// create sprite image
				function createSpriteImg(cb) {
					createSprite(sliceData.imgList, options, cb);
				},
				// write sprite image file
				function writeSrpiteFile(spriteImgData, cb) {
		            // cssFilename, timestamp
		            var 
		            cssFilename = path.basename(src, '.css'),
		            timeNow = grunt.template.today('yyyymmddHHmmss');

		            if(options.newsprite){
		                cssFilename += '-' + timeNow;
		            }

		            sliceData.cssFilename = cssFilename;
		            sliceData.timestamp = options.spritestamp ? ('?'+timeNow) : '';

		            // write file
		            var imgDest = sliceData.imgDest = path.join(options.spritedest, cssFilename + '.png');

		            sliceData.destImgStamp = options.spritestamp ? '?' + timeNow : '';

	                grunt.file.write(imgDest, spriteImgData.image, { encoding: 'binary' });
	                grunt.log.writelns(('Done! [Created] -> ' + imgDest));

	                cb(null, spriteImgData.coordinates);
				},
				// set slice position
				function setSlicePosition(coords, cb) {
					var 
					rsemicolon = /;\s*$/,
					spriteFilename = path.basename(sliceData.imgDest),
					spriteImg = path.join(options.spritepath + spriteFilename) + sliceData.destImgStamp;

					sliceData.cssList.forEach(function(cssItem) {
						var 
						css = cssItem.css,
						coord = coords[cssItem.imgFullPath];

						css = css.replace(cssItem.imgPath, spriteImg);

						// Add a semicolon if needed
	                    if(!rsemicolon.test(css)){
	                        css += ';';
	                    }
						css += ' background-position:-'+ coord.x +'px -'+ coord.y +'px;';

						cssItem.newCss = css;
					});

					cb(null);
				},
				// get retina image
				function getRetinaImg(cb) {
					if(options.useimageset) {
						return cb(null, null);
					}

					var 
					retinaImgList = sliceData.retinaImgList = [],
					retinaImgHash = sliceData.retinaImgHash = {};

					sliceData.cssList.forEach(function(cssItem, id) {
						var 
						extName = path.extname(cssItem.imgPath),
						filename = path.basename(cssItem.imgPath, extName),
						retinaImgFullPath = path.join(path.dirname(cssItem.imgFullPath), filename + '@2x' + extName);

						if(retinaImgHash[retinaImgFullPath] == null && grunt.file.exists(retinaImgFullPath)) {
							retinaImgHash[retinaImgFullPath] = id;
							cssItem.retinaImgFullPath = retinaImgFullPath;

							retinaImgList.push(retinaImgFullPath);
						}
					});

					if(retinaImgList.length > 0) {
						return createSprite(retinaImgList, options, cb);
					}

					cb(null, null);
				},
				// write retina sprite image file
				function writeRetinaeImgFile(retinaSpriteImgData, cb) {
					if(retinaSpriteImgData) {
						sliceData.retinaSpriteImgData = retinaSpriteImgData;

						var retinaImgDest = sliceData.imgDest.replace(/\.png$/, '@2x.png');

						sliceData.retinaImgDest = retinaImgDest;

                        grunt.file.write(retinaImgDest, retinaSpriteImgData.image, { encoding: 'binary' });
                        grunt.log.writelns(('Done! [Created] -> ' + retinaImgDest));
					}

					cb(null);
				},
				// replace css
				function replaceCss(cb) {
					var 
					cssList = sliceData.cssList,
					retinaSpriteImgData = sliceData.retinaSpriteImgData,
					coords = retinaSpriteImgData ? retinaSpriteImgData.coordinates : {};

				    var 
				    cssData = sliceData.cssData,
				    // a[href*='}{']::after{ content:'}{';} 规避此类奇葩CSS
				    tmpCss = cssData.replace(/[:=]\s*([\'\"]).*?\1/g, function(a){
				        return a.replace(/\}/g, '');
				    });

					var 
					rreEscape = /[-\/\\^$*+?.()|[\]{}]/g,
					cssSelectorHash = {},
					cssSelectors = [],
					cssProps = [],
					lastInx = -1;

					sliceData.cssData = cssData.replace(R_SLICE_PLACE, function(place, id) {
						var 
						cssItem = cssList[parseInt(id, 10)],
						ret = cssItem ? cssItem.newCss : '';

						if(!cssItem) {
							return ret;
						}

						var coordData = coords[cssItem.retinaImgFullPath];
						if(!coordData || !cssItem.retinaImgFullPath) {
							return ret;
						}

						// media query retina css
						var 
						selector,
						place = SLICE_PLACE.replace('{id}', id),
						rselector = new RegExp('([^}\\n\\/]+)\\{[^\\}]*?' + place.replace(rreEscape, '\\$&'));
						tmpCss =  tmpCss.replace(rselector, function(a, b) {
							selector = b;
							return b + '{';
						});

						if(!selector) {
							return ret;
						}

						var selectorInx = ++lastInx;
		                cssSelectors[selectorInx] = selector;
		                cssProps[selectorInx] = selector + ' { background-position:-';
		                cssProps[selectorInx] += (coordData.x/2) + 'px -' + (coordData.y/2) + 'px;}';

		                // unique selector, and keep selector order
		                selectorInx = cssSelectorHash[selector];
		                if(isFinite(selectorInx)) {
		                    cssSelectorHash[selector] = --lastInx;
		                    cssSelectors.splice(selectorInx, 1);
		                    cssProps.splice(selectorInx, 1);
		                }
		                else {
		                    cssSelectorHash[selector] = lastInx;
		                }

						return ret;
					});

					if(retinaSpriteImgData) {
						var 
						spriteFilename = path.basename(sliceData.retinaImgDest),
						bgWidth = Math.floor(retinaSpriteImgData.properties.width / 2),
						spriteImg = path.join(options.spritepath + spriteFilename) + sliceData.destImgStamp;

						var retinaCss = '\n\n/* '+ spriteImg + ' */\n';

						// http://w3ctech.com/p/1430
						retinaCss += '@media only screen and (-o-min-device-pixel-ratio: 3/2), only screen and (min--moz-device-pixel-ratio: 1.5), only screen and (-webkit-min-device-pixel-ratio: 1.5), only screen and (min-resolution: 240dpi), only screen and (min-resolution: 2dppx) {';

						retinaCss += '\n  ';
						retinaCss += cssSelectors.join(',\n  ');
			            retinaCss += ' { background-image:url('+ spriteImg +'); background-size:' + bgWidth + 'px auto;}';
			            retinaCss += '\n  ';
			            retinaCss += cssProps.join('\n  ');
			            retinaCss += '\n}\n';

			            sliceData.cssData += retinaCss;
					}

					cb(null);
				},
				// write css file
				function writeCssFile(cb) {
					// timestamp
					if(options.cssstamp) {
						sliceData.cssData += '\n.css_stamp{ content:"'+ sliceData.timestamp.slice(1) +'";}';
					}

					grunt.file.write(cssDest, sliceData.cssData);
            		grunt.log.writelns(('Done! [Created] -> ' + cssDest));

					cb(null);
				}
			], callback);
		}, function(ret) {
			done(ret);
		});
	});
};