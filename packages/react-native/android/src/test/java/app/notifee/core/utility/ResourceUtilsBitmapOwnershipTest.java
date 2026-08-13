package app.notifee.core.utility;

/*
 * Copyright (c) 2016-present Invertase Limited & Contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this library except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNotSame;
import static org.junit.Assert.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.same;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Color;
import app.notifee.core.ContextHolder;
import com.facebook.common.references.CloseableReference;
import com.facebook.drawee.backends.pipeline.Fresco;
import com.facebook.imagepipeline.core.ImagePipeline;
import com.facebook.imagepipeline.datasource.SettableDataSource;
import com.facebook.imagepipeline.image.CloseableBitmap;
import com.facebook.imagepipeline.image.CloseableImage;
import com.facebook.imagepipeline.request.ImageRequest;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.MockedStatic;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;

@RunWith(RobolectricTestRunner.class)
public class ResourceUtilsBitmapOwnershipTest {
  private Context previousApplicationContext;

  @Before
  public void setUp() {
    previousApplicationContext = ContextHolder.getApplicationContext();
    ContextHolder.setApplicationContext(RuntimeEnvironment.getApplication());
  }

  @After
  public void tearDown() {
    ContextHolder.setApplicationContext(previousApplicationContext);
  }

  @Test
  public void getImageBitmapFromUrl_frescoReleasesSource_returnedBitmapRemainsValid()
      throws Exception {
    Context application = ContextHolder.getApplicationContext();
    int knownPixel = Color.argb(255, 17, 34, 51);
    AtomicInteger releaseCount = new AtomicInteger();
    Bitmap original = Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888);
    original.setPixel(1, 1, knownPixel);

    CloseableReference<Bitmap> sourceBitmapReference =
        CloseableReference.of(
            original,
            bitmap -> {
              releaseCount.incrementAndGet();
              bitmap.recycle();
            });
    SettableDataSource<CloseableImage> dataSource = SettableDataSource.create();
    Bitmap result = null;
    Bitmap verificationCopy = null;

    try {
      CloseableBitmap closeableBitmap = mock(CloseableBitmap.class);
      when(closeableBitmap.getUnderlyingBitmap()).thenReturn(original);
      doAnswer(
              invocation -> {
                sourceBitmapReference.close();
                return null;
              })
          .when(closeableBitmap)
          .close();

      try (CloseableReference<CloseableImage> imageReference =
          CloseableReference.of((CloseableImage) closeableBitmap)) {
        assertTrue(dataSource.set(imageReference));
      }

      ImagePipeline imagePipeline = mock(ImagePipeline.class);
      when(imagePipeline.fetchDecodedImage(any(ImageRequest.class), same(application)))
          .thenReturn(dataSource);

      try (MockedStatic<Fresco> fresco = mockStatic(Fresco.class)) {
        fresco.when(Fresco::hasBeenInitialized).thenReturn(true);
        fresco.when(Fresco::getImagePipeline).thenReturn(imagePipeline);

        result =
            ResourceUtils.getImageBitmapFromUrl("https://example.invalid/image.png")
                .get(5, TimeUnit.SECONDS);

        verify(imagePipeline).fetchDecodedImage(any(ImageRequest.class), same(application));
      }

      assertEquals(1, releaseCount.get());
      assertTrue(dataSource.isClosed());
      assertTrue(original.isRecycled());
      assertNotNull(result);
      assertNotSame(original, result);
      assertFalse(result.isRecycled());
      assertEquals(knownPixel, result.getPixel(1, 1));

      verificationCopy = result.copy(Bitmap.Config.ARGB_8888, false);
      assertNotNull(verificationCopy);
      assertFalse(verificationCopy.isRecycled());
      assertEquals(knownPixel, verificationCopy.getPixel(1, 1));
    } finally {
      dataSource.close();
      sourceBitmapReference.close();
      if (verificationCopy != null && !verificationCopy.isRecycled()) {
        verificationCopy.recycle();
      }
      if (result != null && result != original && !result.isRecycled()) {
        result.recycle();
      }
      if (!original.isRecycled()) {
        original.recycle();
      }
    }
  }
}
